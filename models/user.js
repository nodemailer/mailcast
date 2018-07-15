'use strict';

const crypto = require('crypto');
const ObjectID = require('mongodb').ObjectID;
const bcrypt = require('bcryptjs');
const emails = require('../lib/emails');
const db = require('../lib/db');
const log = require('npmlog');
const tools = require('../lib/tools');
const settingsModel = require('./settings');

const BCRYPT_ROUNDS = 11; // bcrypt.js benchmark async in a VPS: 261.192ms

module.exports.get = async (user, fields) => {
    let query = {};
    if (ObjectID.isValid(user) || typeof user === 'string') {
        query._id = new ObjectID(user);
    } else if (user && typeof user === 'object') {
        query = user;
    } else {
        return false;
    }

    let queryOptions = {};
    if (fields) {
        queryOptions.fields = fields;
    }

    return await db.client.collection('users').findOne(query, queryOptions);
};

module.exports.list = async (page, limit, textQuery) => {
    page = Math.max(Number(page) || 1, 1);
    limit = Math.max(Number(limit) || 10, 1);

    let query = {};

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

    let total = await db.client.collection('users').count(query);
    let pages = Math.ceil(total / limit) || 1;

    if (total < limit) {
        page = 1;
    } else if ((page - 1) * limit > total) {
        page = pages;
    }

    let users = await db.client
        .collection('users')
        .find(query, {
            limit,
            skip: (page - 1) * limit,
            projection: {
                _id: true,
                email: true,
                name: true,
                created: true
            },
            sort: {
                name: 1
            }
        })
        .toArray();

    return { users, total, page, pages };
};

module.exports.authenticate = async data => {
    let query = {
        uemail: tools.normalizeEmail(data.email)
    };

    let userData = await db.client.collection('users').findOne(query, {
        fields: {
            email: true,
            password: true
        }
    });

    if (!userData) {
        return false;
    }

    let success = await bcrypt.compare(data.password, userData.password || '');

    return success ? userData._id : false;
};

module.exports.create = async userData => {
    userData = userData || {};

    if (!userData.email) {
        // email address is mandatory
        throw new Error('Email address is missing');
    }

    let insertData = {};
    Object.keys(userData || {}).forEach(key => {
        let value = userData[key];

        if (key === 'password') {
            // never store plaintext password, always hash first
            value = bcrypt.hashSync(value, BCRYPT_ROUNDS);
        }

        insertData[key] = value;
    });

    if (!insertData.emailValidated) {
        insertData.emailToken = crypto.randomBytes(10).toString('hex');
    }

    insertData.uemail = tools.normalizeEmail(insertData.email);
    insertData.created = new Date();

    let firstUser = false;
    let r;
    try {
        let count = await db.client.collection('users').count();
        if (!count) {
            // first user is always an admin
            insertData.status = 'admin';
            firstUser = true;
        }
        r = await db.client.collection('users').insertOne(insertData);
    } catch (err) {
        let error = new Error('Failed to create user, database error');
        if (err.code === 11000) {
            error = new Error('Duplicate entry error');
            error.details = [{ path: 'email', message: 'Another account has already been registered with this email address' }];
        }
        error.sourceError = err;
        error.data = insertData;

        throw error;
    }

    let insertedId = r.insertedId;

    if (!insertedId) {
        return false;
    }

    insertData._id = insertedId;

    if (!insertData.emailValidated) {
        setImmediate(() => emails.emailValidation(insertData).catch(() => false));
    } else {
        insertData.password = userData.password;
        setImmediate(() => emails.welcome(insertData).catch(() => false));
    }

    if (firstUser) {
        // disable public signup until admin has reopened it
        try {
            await settingsModel.set('global_user_disableJoin', true);
        } catch (err) {
            log.error('Settings', 'SETFAIL key=% error=%', 'global_user_disableJoin', err.message);
        }
    }

    return insertedId;
};

module.exports.update = async (user, updates, options) => {
    options = options || {};
    let updateData = {};
    let hasUpdates = false;

    Object.keys(updates || {}).forEach(key => {
        let value = updates[key];

        if (key === 'password') {
            // never store plaintext password, always hash first
            value = bcrypt.hashSync(value, BCRYPT_ROUNDS);
        }

        if (['_id', 'uemail'].concat(options.allowEmailChange ? [] : 'email').includes(key)) {
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

        if (key === 'email') {
            updateData.$set.uemail = tools.normalizeEmail(value);
        }

        hasUpdates = true;
    });

    if (!hasUpdates) {
        return false;
    }

    let query = {};
    if (ObjectID.isValid(user) || typeof user === 'string') {
        query._id = new ObjectID(user);
    } else if (user && typeof user === 'object') {
        query = user;
    } else {
        return false;
    }

    let r;
    try {
        r = await db.client.collection('users').findOneAndUpdate(query, updateData, {
            returnOriginal: false
        });
    } catch (err) {
        let error = new Error('Failed to update user, database error');
        if (err.code === 11000) {
            error = new Error('Duplicate entry error');
        }
        error.sourceError = err;
        error.query = query;
        throw error;
    }

    return r && r.value;
};

module.exports.validateEmail = async data => {
    let query = {
        email: data.email,
        emailToken: data.token
    };

    let r;
    try {
        r = await db.client.collection('users').findOneAndUpdate(
            query,
            {
                $set: {
                    emailValidated: new Date(),
                    emailToken: false
                }
            },
            {
                returnOriginal: false,
                projection: {
                    _id: true,
                    email: true
                }
            }
        );
    } catch (err) {
        let error = new Error('Failed to update user, database error');
        error.sourceError = err;
        error.query = query;
        throw error;
    }

    let userData = r && r.value;
    if (!userData) {
        return false;
    }

    return userData._id;
};

module.exports.initiateRecovery = async data => {
    let query = {
        uemail: tools.normalizeEmail(data.email)
    };
    let recoveryToken = crypto.randomBytes(10).toString('hex');
    let recoveryStarted = new Date();

    let r;
    try {
        r = await db.client.collection('users').findOneAndUpdate(
            query,
            {
                $set: {
                    recoveryToken,
                    recoveryStarted
                }
            },
            {
                returnOriginal: false,
                projection: {
                    _id: true,
                    email: true,
                    name: true,
                    recoveryToken: true
                }
            }
        );
    } catch (err) {
        let error = new Error('Failed to update user, database error');
        error.sourceError = err;
        error.query = query;
        throw error;
    }

    let userData = r && r.value;
    if (!userData) {
        log.info('Recovery', 'RECOVERYFAIL email=%s ip=%s error=Unknown email address', data.email, data.ip);
        return false;
    }

    setImmediate(() => emails.accountRecovery(userData).catch(() => false));

    return userData._id;
};

module.exports.accountRecovery = async data => {
    let query = {
        uemail: tools.normalizeEmail(data.email)
    };

    let r;
    try {
        r = await db.client.collection('users').findOneAndUpdate(
            query,
            {
                $set: {
                    password: bcrypt.hashSync(data.password, BCRYPT_ROUNDS),
                    recoveryToken: false,
                    recoveryStarted: false
                }
            },
            {
                returnOriginal: false,
                projection: {
                    _id: true,
                    email: true,
                    name: true
                }
            }
        );
    } catch (err) {
        let error = new Error('Failed to update user, database error');
        error.sourceError = err;
        error.query = query;
        throw error;
    }

    let userData = r && r.value;
    if (!userData) {
        return false;
    }

    log.info('Recovery', '%s RECOVERYOK email=%s ip=%s', userData._id, data.email, data.ip);

    return userData._id;
};

module.exports.delete = async user => {
    user = new ObjectID(user);

    let r;

    r = await db.client.collection('users').deleteOne({ _id: user });
    if (!r.deletedCount) {
        return false;
    }

    try {
        r = await db.client.collection('lists').deleteOne({ user });
    } catch (err) {
        // just ignore, user entry is already gone anyway
    }

    try {
        await db.client.collection('subscribers').deleteMany({ user });
    } catch (err) {
        // just ignore, user entry is already gone anyway
    }

    try {
        await db.client.collection('templates').deleteMany({ user });
    } catch (err) {
        // just ignore, user entry is already gone anyway
    }

    try {
        await db.client.collection('messages').deleteMany({ user });
    } catch (err) {
        // just ignore, user entry is already gone anyway
    }

    try {
        await db.client.collection('emails').deleteMany({ user });
    } catch (err) {
        // ignore
    }

    return true;
};

module.exports.showJSONErrors = (req, res, err) => {
    let response = {
        success: false,
        error: err.message
    };

    if (err.code) {
        response.errorCode = err.code;
    }

    if (err && err.details) {
        err.details.forEach(detail => {
            if (!response.details || !response.details[detail.path]) {
                if (!response.details) {
                    response.details = {};
                }
                response.details[detail.path] = detail.message;
            }
        });
    }
    res.json(response);
};
