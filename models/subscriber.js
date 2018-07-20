'use strict';

const ObjectID = require('mongodb').ObjectID;
const db = require('../lib/db');
const tools = require('../lib/tools');
const crypto = require('crypto');
const emails = require('../lib/emails');
const log = require('npmlog');
const listModel = require('./list');

const statuses = {
    subscribed: 'Subscribed',
    unsubscribed: 'Unsubscribed',
    unconfirmed: 'Unconfirmed',
    bounced: 'Bounced'
};

module.exports.get = async (subscriber, fromPending) => {
    let query = {};
    if (ObjectID.isValid(subscriber) || typeof subscriber === 'string') {
        query._id = new ObjectID(subscriber);
    } else if (subscriber && typeof subscriber === 'object') {
        query = subscriber;
    } else {
        return false;
    }

    let subscriberData = await db.client.collection('subscribers').findOne(query);
    if (!subscriberData && fromPending) {
        subscriberData = await db.client.collection('pending').findOne(query);
    }

    return subscriberData;
};

module.exports.list = async (list, page, limit, textQuery) => {
    page = Math.max(Number(page) || 1, 1);
    limit = Math.max(Number(limit) || 10, 1);

    let query = {
        list: new ObjectID(list)
    };

    if (textQuery) {
        query.$or = [
            {
                name: {
                    $regex: textQuery.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'),
                    $options: 'i'
                }
            },
            {
                uemail: {
                    $regex: textQuery.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'),
                    $options: 'i'
                }
            }
        ];
    }

    let total = await db.client.collection('subscribers').count(query);
    let pages = Math.ceil(total / limit) || 1;

    if (total < limit) {
        page = 1;
    } else if ((page - 1) * limit > total) {
        page = pages;
    }

    let subscribers = await db.client
        .collection('subscribers')
        .find(query, {
            limit,
            skip: (page - 1) * limit,
            projection: {
                _id: true,
                list: true,
                name: true,
                email: true,
                status: true,
                testSubscriber: true,
                created: true
            },
            sort: {
                name: 1
            }
        })
        .toArray();

    return { subscribers, total, page, pages };
};

module.exports.create = async (user, list, insertData, options) => {
    options = options || {};

    insertData.email = insertData.fields.EMAIL;
    insertData.name = [insertData.fields.FNAME || '', insertData.fields.LNAME || ''].filter(n => n).join(' ');

    let now = new Date();
    let subscriberData = {
        _id: new ObjectID(),
        user,
        list,
        created: now,
        updated: null,
        uemail: tools.normalizeEmail(insertData.email),
        email: insertData.email,
        status: insertData.status || 'unconfirmed',
        confirmToken: crypto.randomBytes(10).toString('hex'),
        messages: 0
    };

    Object.keys(insertData || {}).forEach(key => {
        if (!(key in subscriberData)) {
            subscriberData[key] = insertData[key];
        }
    });

    if (subscriberData.fields && subscriberData.fields.PGP) {
        try {
            subscriberData.keyInfo = await tools.checkPubKey(subscriberData.fields.PGP);
        } catch (err) {
            subscriberData.keyInfo = false;
            subscriberData.fields.PGP = 'Failed to process public key: ' + err.message;
            log.error('PGP', 'PGPERROR subscriber=%s error=%s', subscriberData._id, err.message);
        }
    }

    let emailSent = false;

    let r;
    try {
        r = await db.client.collection('subscribers').insertOne(subscriberData);
    } catch (err) {
        let error = new Error('Failed to add subscriber, database error');

        if (err.code === 11000) {
            try {
                let existingSubscriber = await db.client.collection('subscribers').findOne({ list, uemail: subscriberData.uemail });
                if (existingSubscriber) {
                    if (options.updateExisting) {
                        // admin edited, so merge
                        await module.exports.update(existingSubscriber._id, insertData);
                        return { subscriber: existingSubscriber._id, emailSent };
                    } else {
                        // web form tried to resubscribe, send another confirm message before merging
                        subscriberData.parent = existingSubscriber._id;
                        // have to reuse exitsing token instead of keeping the new one
                        subscriberData.confirmToken = existingSubscriber.confirmToken;
                        await db.client.collection('pending').insertOne(subscriberData);
                        let listData = await db.client.collection('lists').findOne({ _id: list });
                        if (listData) {
                            emailSent = true;
                            setImmediate(() => emails.emailSubscriberConfirmation(listData, subscriberData).catch(() => false));
                        }
                        return { subscriber: existingSubscriber._id, emailSent };
                    }
                }
            } catch (err) {
                // just ignore
            }
        }

        error.sourceError = err;
        error.data = insertData;

        throw error;
    }

    if (!r || !r.insertedId) {
        throw new Error('Failed to add subscriber');
    }

    subscriberData._id = r.insertedId;

    if (subscriberData.status === 'subscribed') {
        try {
            await db.client.collection('lists').updateOne({ _id: list }, { $inc: { subscribers: 1 } });
        } catch (err) {
            // kind of ignore. breaks the counter but subscription is already created
        }
    }

    if (subscriberData.status === 'unconfirmed') {
        try {
            let listData = await db.client.collection('lists').findOne({ _id: list });
            if (listData) {
                emailSent = true;
                setImmediate(() => emails.emailSubscriberConfirmation(listData, subscriberData).catch(() => false));
            }
        } catch (E) {
            //
        }
    }

    return { subscriber: r.insertedId, emailSent };
};

module.exports.update = async (subscriber, updateData, options) => {
    options = options || {};

    let query = {};
    if (ObjectID.isValid(subscriber) || typeof subscriber === 'string') {
        query._id = new ObjectID(subscriber);
    } else if (subscriber && typeof subscriber === 'object') {
        query = subscriber;
    } else {
        return false;
    }

    let subscriberData = {
        $set: {
            updated: new Date()
        }
    };

    updateData = updateData || {};

    if (updateData.fields) {
        if (updateData.fields.EMAIL) {
            updateData.email = updateData.fields.EMAIL;
        }
        updateData.name = [updateData.fields.FNAME || '', updateData.fields.LNAME || ''].filter(n => n).join(' ');
        if (updateData.fields.PGP) {
            try {
                subscriberData.$set.keyInfo = await tools.checkPubKey(updateData.fields.PGP);
            } catch (err) {
                subscriberData.$set.keyInfo = false;
                updateData.fields.PGP = 'Failed to process public key: ' + err.message;
                log.error('PGP', 'PGPERROR subscriber=%s error=%s', subscriber, err.message);
            }
        } else if (updateData.fields.hasOwnProperty('PGP')) {
            // clear key
            subscriberData.$set.keyInfo = false;
        }
    }

    Object.keys(updateData).forEach(key => {
        if (['user', 'list', 'subscriber', 'email', 'uemail', '$inc', '$set'].includes(key)) {
            return;
        }
        subscriberData.$set[key] = updateData[key];
    });

    let statusChanged = false;
    let emailChanged = false;

    let existingData;
    if (updateData.status || updateData.email) {
        try {
            existingData = await db.client.collection('subscribers').findOne(query);

            if (
                updateData.status &&
                existingData.status !== updateData.status &&
                (existingData.status === 'subscribed' || updateData.status === 'subscribed')
            ) {
                statusChanged = true;
            }

            if (updateData.email && existingData.uemail !== tools.normalizeEmail(updateData.email)) {
                if (options.validateEmailChange) {
                    emailChanged = true;
                    subscriberData.$set.tempEmail = updateData.email;
                    subscriberData.$set.tempValid = new Date(Date.now() + 24 * 3600 * 1000);
                } else {
                    subscriberData.$set.email = updateData.email;
                    subscriberData.$set.uemail = tools.normalizeEmail(updateData.email);
                }
            }
        } catch (err) {
            // just ignore
        }
    }

    let r;
    try {
        r = await db.client.collection('subscribers').findOneAndUpdate(query, subscriberData, { returnOriginal: false });
    } catch (err) {
        let error = new Error('Failed to update subscriber, database error');

        if (err.code === 11000) {
            error = new Error('Duplicate entry error');
            error.details = [{ path: 'email', message: 'Another subscriber already has been registered with this email address' }];
        }

        error.sourceError = err;
        error.data = updateData;

        throw error;
    }

    if (!r || !r.value) {
        throw new Error('Failed to update subscriber');
    }

    subscriberData = r.value;

    if (statusChanged) {
        try {
            await db.client.collection('lists').updateOne(
                { _id: existingData.list },
                {
                    $inc: {
                        subscribers: updateData.status === 'subscribed' ? 1 : -1
                    }
                }
            );
        } catch (err) {
            // just ignore
        }
    }

    if (emailChanged) {
        try {
            let listData = await db.client.collection('lists').findOne({ _id: subscriberData.list });
            setImmediate(() => emails.emailChangeConfirmation(listData, subscriberData).catch(() => false));
        } catch (err) {
            // ignore
        }
    }

    return { subscriberData, emailChanged, statusChanged };
};

module.exports.delete = async subscriber => {
    let query = {
        _id: new ObjectID(subscriber)
    };

    let subscriberData = await db.client.collection('subscribers').findOne(query);

    if (!subscriberData) {
        return false;
    }

    let r = await db.client.collection('subscribers').deleteOne(query);
    if (!r.deletedCount) {
        return false;
    }

    try {
        if (subscriberData.status === 'subscribed') {
            await db.client.collection('lists').updateOne(
                { _id: subscriberData.list },
                {
                    $inc: {
                        subscribers: -1
                    }
                }
            );
        }
    } catch (err) {
        // just ignore
    }

    return r.deletedCount;
};

module.exports.activatePending = async subscriberData => {
    let existingSubscriber = await db.client.collection('subscribers').findOne({ _id: subscriberData.parent });

    if (!existingSubscriber) {
        // see if the list still exists
        let listData = await db.client.collection('lists').findOne({ _id: subscriberData.list }, { projection: { _id: true } });
        if (!listData) {
            // list is already deleted
            await db.client.collection('pending').deleteOne({ _id: subscriberData._id });
            let error = new Error('Subscription not found');
            error.status = 404;
            throw error;
        }

        // no parent, signup as is
        delete subscriberData.parent;
        // make sure the entry is unconfirmed that gets changed in a later step, otherwise we might break the 'members' counter for the list
        subscriberData.status = 'unconfirmed';
        await db.client.collection('subscribers').insertOne(subscriberData);
        try {
            await db.client.collection('pending').deleteOne({ _id: subscriberData._id });
        } catch (err) {
            //ignore, expires anyway
        }
        return subscriberData;
    }

    let updates = {
        $set: {}
    };

    // update whitelisted keys only
    Object.keys(subscriberData).forEach(key => {
        if (['name', 'tz', 'fields'].includes(key)) {
            updates.$set[key] = subscriberData[key];
        }
    });

    let r = await db.client.collection('subscribers').findOneAndUpdate({ _id: existingSubscriber._id }, updates, {
        returnOriginal: false
    });

    if (!r || !r.value) {
        throw new Error('Failed to update record in database');
    }

    return r && r.value;
};

module.exports.listSubscriptions = async (email, list, page, limit) => {
    page = Math.max(Number(page) || 1, 1);
    limit = Math.max(Number(limit) || 10, 1);
    let uemail = tools.normalizeEmail(email);

    let query = {
        uemail
    };

    let total = await db.client.collection('subscribers').count(query);
    let pages = Math.ceil(total / limit) || 1;

    if (total < limit) {
        page = 1;
    } else if ((page - 1) * limit > total) {
        page = pages;
    }

    let subscriptions = await db.client
        .collection('subscribers')
        .find(query, {
            limit,
            skip: (page - 1) * limit,
            projection: {
                _id: true,
                list: true,
                name: true,
                email: true,
                status: true,
                testSubscriber: true,
                created: true
            },
            sort: {
                name: 1
            }
        })
        .toArray();

    // perform local JOIN to get list info
    let lists = new Map();
    for (let subscriptionData of subscriptions) {
        subscriptionData.statusStr = statuses[subscriptionData.status];
        let list = subscriptionData.list.toString();
        if (lists.has(list)) {
            subscriptionData.listData = lists.get(list);
            continue;
        }
        try {
            let listData = await listModel.get(subscriptionData.list);
            lists.set(list, listData || {});
            subscriptionData.listData = listData;
        } catch (err) {
            // ignore
            subscriptionData.listData = {};
        }
    }

    return { subscriptions, total, page, pages };
};

module.exports.createToken = async email => {
    let uemail = tools.normalizeEmail(email);

    let tokenData = {
        uemail,
        token: crypto.randomBytes(10).toString('hex'),
        created: new Date()
    };

    await db.client.collection('subscribertokens').insertOne(tokenData);
    return tokenData.token;
};

module.exports.checkToken = async (email, token) => {
    let uemail = tools.normalizeEmail(email);
    let query = {
        uemail,
        token
    };
    let tokenData = await db.client.collection('subscribertokens').findOne(query);
    if (!tokenData) {
        let error = new Error('Invalid or expired verification token');
        error.status = 403;
        throw error;
    }
    return true;
};

module.exports.sendToken = async email => {
    let token = await module.exports.createToken(email);
    setImmediate(() => emails.emailSubscriptionsToken({ email, token }).catch(() => false));
};
