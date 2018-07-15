'use strict';

const ObjectID = require('mongodb').ObjectID;
const db = require('../lib/db');
const log = require('npmlog');

module.exports.get = async (message, fields, options) => {
    options = options || {};

    let query = {};
    if (ObjectID.isValid(message) || typeof message === 'string') {
        query._id = new ObjectID(message);
    } else if (message && typeof message === 'object') {
        query = message;
    } else {
        return false;
    }

    let queryOptions = {};
    if (fields) {
        queryOptions.fields = fields;
    }

    let messageData = await db.client.collection('messages').findOne(query, queryOptions);

    if (!messageData && !options.allowMissing) {
        let error = new Error('Message not found');
        error.status = 404;
        throw error;
    }

    if (messageData && options.user && messageData.user.toString() !== options.user.toString()) {
        let error = new Error('Not permitted to access selected message');
        error.status = 503;
        throw error;
    }

    return messageData;
};

module.exports.list = async (user, page, limit) => {
    page = Math.max(Number(page) || 1, 1);
    limit = Math.max(Number(limit) || 10, 1);

    let query = {
        user: new ObjectID(user)
    };

    let total = await db.client.collection('messages').count(query);
    let pages = Math.ceil(total / limit) || 1;

    if (total < limit) {
        page = 1;
    } else if ((page - 1) * limit > total) {
        page = pages;
    }

    let messages = await db.client
        .collection('messages')
        .find(query, {
            limit,
            skip: (page - 1) * limit,
            projection: {
                _id: true,
                list: true,
                subject: true,
                status: true,
                created: true
            },
            sort: {
                created: -1
            }
        })
        .toArray();

    // perform local JOIN
    let uniqueLists = new Map();
    for (let message of messages) {
        if (!message || !message.list) {
            continue;
        }

        if (uniqueLists.has(message.list.toString())) {
            message.listData = uniqueLists.get(message.list.toString());
            continue;
        }

        try {
            let listData = await db.client.collection('lists').findOne(
                { _id: message.list },
                {
                    projection: {
                        _id: true,
                        name: true,
                        subscribers: true
                    }
                }
            );
            if (listData) {
                message.listData = listData;
                uniqueLists.set(message.list.toString(), listData);
            }
        } catch (err) {
            // ignore
        }
    }

    return { messages, total, page, pages };
};

module.exports.create = async (user, messsageData) => {
    messsageData = messsageData || {};

    let insertData = {
        user,
        list: new ObjectID(messsageData.list),
        template: messsageData.template ? new ObjectID(messsageData.template) : messsageData.template,
        locked: 0
    };

    Object.keys(messsageData || {}).forEach(key => {
        let value = messsageData[key];
        if (!insertData.hasOwnProperty(key)) {
            insertData[key] = value;
        }
    });

    if (!insertData.status) {
        insertData.status = 'draft';
    }
    insertData.draft = insertData.status === 'draft';

    insertData.created = new Date();

    let r;
    try {
        r = await db.client.collection('messages').insertOne(insertData);
    } catch (err) {
        let error = new Error('Failed to create message, database error');
        error.sourceError = err;
        error.data = insertData;
        throw error;
    }

    let insertedId = r.insertedId;

    if (!insertedId) {
        return false;
    }

    insertData._id = insertedId;

    return insertedId;
};

module.exports.update = async (message, updates, options) => {
    options = options || {};
    let updateData = {};
    let hasUpdates = false;

    Object.keys(updates || {}).forEach(key => {
        let value = updates[key];

        if (['_id', 'user', 'list'].includes(key)) {
            return;
        }

        if (key.charAt(0) === '$') {
            updateData[key] = value;
        } else if (!updateData.$set) {
            updateData.$set = {
                [key]: value
            };
        } else {
            updateData.$set[key] = value;
        }

        hasUpdates = true;
    });

    if (!hasUpdates) {
        return false;
    }

    let query = {};
    if (ObjectID.isValid(message) || typeof message === 'string') {
        query._id = new ObjectID(message);
    } else if (message && typeof message === 'object') {
        query = message;
    } else {
        return false;
    }

    let r;
    try {
        let queryOptions = {
            returnOriginal: false
        };

        if (options.publish) {
            queryOptions.projection = {
                status: true,
                counters: true
            };
        }

        r = await db.client.collection('messages').findOneAndUpdate(query, updateData, queryOptions);

        if (options.publish && r && r.value) {
            db.redis.publish('mailcast.' + r.value._id, JSON.stringify(r.value));
        }
    } catch (err) {
        let error = new Error('Failed to update message, database error');
        if (err.code === 11000) {
            error = new Error('Duplicate entry error');
        }
        error.sourceError = err;
        error.query = query;
        throw error;
    }

    return r && r.value;
};

module.exports.delete = async message => {
    message = new ObjectID(message);

    let r;

    r = await db.client.collection('messages').deleteOne({ _id: message });
    if (!r.deletedCount) {
        return false;
    }

    try {
        await db.client.collection('emails').deleteMany({ message });
    } catch (err) {
        // ignore
    }

    return true;
};

class Sub {
    constructor() {
        this.redis = db.redis.duplicate();
        this.subscriptions = new Map();

        this.redis.on('message', (channel, message) => {
            let data;
            try {
                data = JSON.parse(message);
            } catch (err) {
                log.error('Stream', 'JSON error=%s', err.message);
                return;
            }

            if (this.subscriptions.has(channel)) {
                for (let handler of this.subscriptions.get(channel)) {
                    try {
                        handler(data);
                    } catch (err) {
                        // ignore
                        log.error('Stream', err);
                    }
                }
            }
        });
    }

    async subscribe(message, handler) {
        let channel = 'mailcast.' + (message || '').toString();

        if (this.subscriptions.has(channel)) {
            this.subscriptions.get(channel).add(handler);
            return;
        }

        this.subscriptions.set(channel, new Set([handler]));
        await this.redis.subscribe(channel);

        return {
            message,
            handler,
            close: async () => {
                if (!this.subscriptions.has(channel)) {
                    return 0;
                }
                let handlers = this.subscriptions.get(channel);
                handlers.delete(handler);
                if (!handlers.size) {
                    await this.redis.unsubscribe('mailcast.' + channel);
                    this.subscriptions.delete(channel);
                    return 0;
                }
                return handlers.size;
            },
            publish: async data => {
                db.redis.publish(channel, JSON.stringify(data));
            }
        };
    }
}

module.exports.getPubSub = () => new Sub();
