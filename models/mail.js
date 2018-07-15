'use strict';

const ObjectID = require('mongodb').ObjectID;
const db = require('../lib/db');
const SeqIndex = require('seq-index');
const seqIndex = new SeqIndex();

module.exports.get = async (email, fields, options) => {
    options = options || {};

    let query = {};
    if (ObjectID.isValid(email) || typeof email === 'string') {
        query._id = new ObjectID(email);
    } else if (email && typeof email === 'object') {
        query = email;
    } else {
        return false;
    }

    let queryOptions = {};
    if (fields) {
        queryOptions.fields = fields;
    }

    let emailData = await db.client.collection('emails').findOne(query, queryOptions);

    if (!emailData && !options.allowMissing) {
        let error = new Error('Email not found');
        error.status = 404;
        throw error;
    }

    if (emailData && options.user && emailData.user.toString() !== options.user.toString()) {
        let error = new Error('Not permitted to access selected email');
        error.status = 503;
        throw error;
    }

    return emailData;
};

module.exports.create = async mailOptions => {
    if (!mailOptions) {
        return false;
    }

    let _id = new ObjectID();
    let id = seqIndex.get();
    let mailData = {
        _id,
        id,
        created: new Date(),
        status: 'initialized',
        opened: false,
        clicked: false,
        log: []
    };

    Object.keys(mailOptions).forEach(key => {
        if (!mailData.hasOwnProperty(key)) {
            mailData[key] = mailOptions[key];
        }
    });

    let r;
    try {
        r = await db.client.collection('emails').insertOne(mailData);
    } catch (err) {
        let error = new Error('Failed to create mail entry, database error');
        error.sourceError = err;
        error.data = mailData;
        throw error;
    }

    if (!r.insertedId) {
        throw new Error('Failed to create mail entry, database error');
    }

    return { _id, id };
};

module.exports.update = async (mail, updates, fields) => {
    let updateData = {};
    let hasUpdates = false;

    Object.keys(updates || {}).forEach(key => {
        let value = updates[key];

        if (['_id', 'id', 'user', 'subscriber'].includes(key)) {
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
    if (ObjectID.isValid(mail) || typeof mail === 'string') {
        query._id = new ObjectID(mail);
    } else if (mail && typeof mail === 'object') {
        query = mail;
    } else {
        return false;
    }

    let queryOpts = {
        returnOriginal: false
    };

    if (fields) {
        queryOpts.projection = fields;
    }

    let r;
    try {
        r = await db.client.collection('emails').findOneAndUpdate(query, updateData, queryOpts);
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

module.exports.updateStatus = async (db, email, status, logInfo) => {
    let updates = {
        $push: {
            log: logInfo
        }
    };

    if (status) {
        updates.$set = { status };
    }

    let r;
    try {
        r = await db.client.collection('emails').findOneAndUpdate({ _id: email }, updates, {
            projection: {
                _id: true,
                message: true,
                subscriber: true,
                bounce: true,
                test: true
            }
        });
    } catch (err) {
        throw err;
    }

    if (!r || !r.value || r.value.bounce || r.value.test) {
        // not found or already processed
        return;
    }

    if (r.value.message && status) {
        // entry existed and not bounced yet, update counter for message
        try {
            let updated = await db.client.collection('messages').findOneAndUpdate(
                { _id: r.value.message },
                {
                    $set: {
                        status: 'sending'
                    },
                    $inc: {
                        ['counters.' + status]: 1
                    }
                },
                {
                    projection: {
                        status: true,
                        counters: true
                    },
                    returnOriginal: false
                }
            );
            if (updated && updated.value) {
                db.redis.publish('mailcast.' + r.value.message, JSON.stringify(updated.value));
            }
        } catch (err) {
            // ignore
        }
    }

    if (r.value.subscriber && status === 'bounced') {
        // email is related to a subscriber that should be unsubscribed
        try {
            let previousData = await db.client.collection('subscribers').findOneAndUpdate(
                { _id: r.value.subscriber },
                {
                    $set: {
                        status,
                        bounce: {
                            message: r.value.message,
                            email,
                            response: logInfo.response,
                            created: new Date()
                        }
                    }
                },
                { returnOriginal: true, projection: { _id: true, status: true, list: true } }
            );

            if (previousData && previousData.status === 'subscribed') {
                await db.client.collection('lists').updateOne(
                    { _id: previousData.list },
                    {
                        $inc: {
                            emails: -1
                        }
                    }
                );
            }
        } catch (err) {
            // ignore
        }
    }
};
