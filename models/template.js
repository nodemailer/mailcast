'use strict';

const ObjectID = require('mongodb').ObjectID;
const db = require('../lib/db');
const fs = require('fs');
const defaultTemplate = fs.readFileSync(__dirname + '/../sources/default-template.html', 'utf-8');

module.exports.defaultTemplate = defaultTemplate;

module.exports.get = async (template, fields, options) => {
    options = options || {};

    if (!template && options.allowDefault) {
        return {
            _id: null,
            name: 'default',
            code: defaultTemplate
        };
    }

    let query = {};
    if (ObjectID.isValid(template) || typeof template === 'string') {
        query._id = new ObjectID(template);
    } else if (template && typeof template === 'object') {
        query = template;
    } else {
        return false;
    }

    let queryOptions = {};
    if (fields) {
        queryOptions.fields = fields;
    }

    let templateData = await db.client.collection('templates').findOne(query, queryOptions);

    if (!templateData && !options.allowMissing) {
        let error = new Error('Template not found');
        error.status = 404;
        throw error;
    }

    if (templateData && options.user && templateData.user.toString() !== options.user.toString()) {
        let error = new Error('Not permitted to access selected template');
        error.status = 403;
        throw error;
    }

    if (!templateData && options.allowDefault) {
        return {
            _id: null,
            name: 'default',
            code: defaultTemplate
        };
    }

    return templateData;
};

module.exports.list = async (user, page, limit) => {
    page = Math.max(Number(page) || 1, 1);
    limit = Math.max(Number(limit) || 10, 1);

    let query = {
        user: new ObjectID(user)
    };

    let total = await db.client.collection('templates').count(query);
    let pages = Math.ceil(total / limit) || 1;

    if (total < limit) {
        page = 1;
    } else if ((page - 1) * limit > total) {
        page = pages;
    }

    let templates = await db.client
        .collection('templates')
        .find(query, {
            limit,
            skip: (page - 1) * limit,
            projection: {
                _id: true,
                name: true,
                created: true
            },
            sort: {
                name: 1
            }
        })
        .toArray();

    return { templates, total, page, pages };
};

module.exports.create = async (user, templateData) => {
    templateData = templateData || {};

    let insertData = {
        user
    };
    Object.keys(templateData || {}).forEach(key => {
        let value = templateData[key];
        if (!insertData.hasOwnProperty(key)) {
            insertData[key] = value;
        }
    });

    insertData.created = new Date();

    let r;
    try {
        r = await db.client.collection('templates').insertOne(insertData);
    } catch (err) {
        let error = new Error('Failed to create template, database error');
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

module.exports.update = async (template, updates) => {
    let updateData = {};
    let hasUpdates = false;

    Object.keys(updates || {}).forEach(key => {
        let value = updates[key];

        if (['_id', 'user'].includes(key)) {
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
    if (ObjectID.isValid(template) || typeof template === 'string') {
        query._id = new ObjectID(template);
    } else if (template && typeof template === 'object') {
        query = template;
    } else {
        return false;
    }

    let r;
    try {
        r = await db.client.collection('templates').findOneAndUpdate(query, updateData, {
            returnOriginal: false
        });
    } catch (err) {
        let error = new Error('Failed to update template, database error');
        if (err.code === 11000) {
            error = new Error('Duplicate entry error');
        }
        error.sourceError = err;
        error.query = query;
        throw error;
    }

    return r && r.value;
};

module.exports.delete = async template => {
    template = new ObjectID(template);

    let r;

    r = await db.client.collection('templates').deleteOne({ _id: template });
    if (!r.deletedCount) {
        return false;
    }

    return true;
};
