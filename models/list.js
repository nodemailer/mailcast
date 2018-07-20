'use strict';

const ObjectID = require('mongodb').ObjectID;
const db = require('../lib/db');

module.exports.get = async (list, fields, options) => {
    options = options || {};

    let query = {};
    if (ObjectID.isValid(list) || typeof list === 'string') {
        query._id = new ObjectID(list);
    } else if (list && typeof list === 'object') {
        query = list;
    } else {
        return false;
    }

    let queryOptions = {};
    if (fields) {
        queryOptions.fields = fields;
    }

    let listData = await db.client.collection('lists').findOne(query, queryOptions);

    if (!listData && !options.allowMissing) {
        let error = new Error('List not found');
        error.status = 404;
        throw error;
    }

    if (listData && options.user && listData.user.toString() !== options.user.toString()) {
        let error = new Error('Not permitted to access selected list');
        error.status = 403;
        throw error;
    }

    return listData;
};

module.exports.list = async (user, page, limit) => {
    page = Math.max(Number(page) || 1, 1);
    limit = Math.max(Number(limit) || 10, 1);

    let query = {
        user: new ObjectID(user)
    };

    let total = await db.client.collection('lists').count(query);
    let pages = Math.ceil(total / limit) || 1;

    if (total < limit) {
        page = 1;
    } else if ((page - 1) * limit > total) {
        page = pages;
    }

    let queryOpts = {
        limit,
        skip: (page - 1) * limit,
        projection: {
            _id: true,
            user: true,
            name: true,
            subscribers: true
        },
        sort: {
            name: 1
        }
    };

    let lists = await db.client
        .collection('lists')
        .find(query, queryOpts)
        .toArray();

    return { lists, total, page, pages };
};

module.exports.create = async (user, insertData) => {
    let listData = {
        user,
        created: new Date(),
        subscribers: 0,
        fields: [
            {
                _id: new ObjectID(),
                key: 'EMAIL',
                name: 'Email address',
                help: 'Valid email address is required',
                type: 'email',
                order: 1,
                orderable: false,
                required: true,
                hidden: false,
                keep: true
            },
            {
                _id: new ObjectID(),
                key: 'FNAME',
                name: 'First name',
                type: 'text',
                order: 2,
                orderable: true,
                required: false,
                hidden: false,
                keep: true
            },
            {
                _id: new ObjectID(),
                key: 'LNAME',
                name: 'Last name',
                type: 'text',
                order: 3,
                orderable: true,
                required: false,
                hidden: false,
                keep: true
            }
        ],
        fieldCounter: 3
    };

    Object.keys(insertData).forEach(key => {
        if (!['fields'].includes(key)) {
            listData[key] = insertData[key];
        }
    });

    (insertData.fields || '')
        .toString()
        .trim()
        .split(/\r?\n/)
        .map(field => field.trim())
        .filter(field => field)
        .forEach(field => {
            listData.fields.push({
                _id: new ObjectID(),
                name: field,
                key: 'MERGE' + (listData.fields.length + 1).toString().padStart(3, '0'),
                type: 'text',
                orderable: true,
                required: false,
                hidden: false,
                keep: false,
                order: listData.fields.length + 1
            });
        });

    if (insertData.pgp) {
        listData.fieldCounter++;
        listData.fields.push({
            _id: new ObjectID(),
            name: 'PGP public key',
            key: 'PGP',
            type: 'pgp',
            orderable: true,
            required: false,
            hidden: false,
            keep: false,
            order: listData.fields.length + 1
        });
    }

    listData.fieldCounter = listData.fields.length;

    let r;
    try {
        r = await db.client.collection('lists').insertOne(listData);
    } catch (err) {
        let error = new Error('Failed to create list, database error');

        error.sourceError = err;
        error.data = insertData;

        throw error;
    }

    if (!r || !r.insertedId) {
        throw new Error('Failed to create list');
    }

    return r.insertedId;
};

module.exports.update = async (list, updateData) => {
    let query = {};
    if (ObjectID.isValid(list) || typeof list === 'string') {
        query._id = new ObjectID(list);
    } else if (list && typeof list === 'object') {
        query = list;
    } else {
        return false;
    }

    let listData = {};

    Object.keys(updateData || {}).forEach(key => {
        if (['user', 'list', '$inc', '$set'].includes(key)) {
            return;
        }

        if (['subscribers'].includes(key)) {
            if (!listData.$inc) {
                listData.$inc = {};
            }
            listData.$inc[key] = updateData[key];
            return;
        }

        if (key === 'pgp') {
            if (!updateData.pgp) {
                listData.$pull = {
                    fields: {
                        type: 'pgp'
                    }
                };
            }
        }

        if (!listData.$set) {
            listData.$set = {};
        }

        listData.$set[key] = updateData[key];
    });

    if (updateData.pgp) {
        // check if PGP field already exists
        let existingData = await db.client.collection('lists').findOne(query, { projection: { fields: true, fieldCounter: true } });
        if (!existingData.fields.find(field => field.type === 'pgp')) {
            if (!listData.inc) {
                listData.$inc = {
                    fieldCounter: 1
                };
            }
            if (!listData.$push) {
                listData.$push = {};
            }
            listData.$push.fields = {
                _id: new ObjectID(),
                name: 'PGP public key',
                key: 'PGP',
                type: 'pgp',
                orderable: true,
                required: false,
                hidden: false,
                keep: false,
                order: existingData.fields.length + 1
            };
        }
    }

    let r;
    try {
        r = await db.client.collection('lists').updateOne(query, listData);
    } catch (err) {
        let error = new Error('Failed to update list, database error');

        error.sourceError = err;
        error.data = updateData;

        throw error;
    }

    if (!r || !r.matchedCount) {
        throw new Error('Failed to update list');
    }

    return r.matchedCount;
};

module.exports.delete = async list => {
    let query = {
        _id: new ObjectID(list)
    };

    let r = await db.client.collection('lists').deleteOne(query);
    if (!r.deletedCount) {
        return false;
    }

    try {
        await db.client.collection('subscribers').deleteMany({
            list: new ObjectID(list)
        });
    } catch (err) {
        // just ignore, list entry is already gone anyway
    }

    try {
        await db.client.collection('messages').deleteMany({
            list: new ObjectID(list)
        });
    } catch (err) {
        // just ignore, list entry is already gone anyway
    }

    return r.deletedCount;
};

module.exports.updateFields = async (listData, updateData) => {
    let updatedFields = {};
    let newFields = [];
    let deletedFields = [];
    let ordering = false;

    let updates = {
        $set: {}
    };

    let curKeys = {};
    listData.fields.forEach(field => {
        curKeys[field.key] = field;
    });

    if (updateData.ordering) {
        ordering = updateData.ordering
            .split(',')
            .map(o => o.trim())
            .filter(o => o);
    }

    Object.keys(updateData.del || {}).forEach(key => {
        if (updateData.del[key] && curKeys[key] && !curKeys[key].keep) {
            deletedFields.push(key);
        }
    });

    let currentOrdering = [];

    listData.fields.forEach(field => {
        if (!deletedFields.includes(field.key)) {
            currentOrdering.push({
                key: field.key,
                order: field.order
            });
        }
    });

    currentOrdering = currentOrdering.sort((a, b) => a.order - b.order).map(o => o.key);

    if (ordering) {
        // filter out unknown fields from new ordering array
        for (let i = ordering.length - 1; i >= 0; i--) {
            if (currentOrdering.indexOf(ordering[i]) < 0) {
                ordering.splice(i, 1);
            }
        }
        // make sure we have all keys listed, add to end if needed
        for (let i = 0; i < currentOrdering.length; i++) {
            if (ordering.indexOf(currentOrdering[i]) < 0) {
                ordering.push(currentOrdering[i]);
            }
        }
    }

    Object.keys(updateData.name || {}).forEach(key => {
        if (deletedFields.includes(key)) {
            return;
        }
        let value = updateData.name[key];
        updatedFields[key] = value;
    });

    let fields = listData.fields.filter(field => {
        let keep = !deletedFields.includes(field.key);
        if (!keep && field.type === 'pgp') {
            updates.$set.pgp = false;
        }
        return keep;
    });

    let startPos = Math.max(listData.fieldCounter || 0, fields.length);
    newFields = (updateData.fields || '')
        .toString()
        .trim()
        .split(/\r?\n/)
        .map(field => field.trim())
        .filter(field => field)
        .map((field, i) => ({
            _id: new ObjectID(),
            name: field,
            key: 'MERGE' + (startPos + i + 1).toString().padStart(3, '0'),
            type: 'text',
            orderable: true,
            required: false,
            hidden: false,
            keep: false,
            order: listData.fieldCounter + i + 1
        }));

    if (newFields.length) {
        updates.$inc = {
            fieldCounter: newFields.length
        };
    }

    updates.$set.fields = fields
        .concat(newFields)
        .map(field => {
            let updatedName = updatedFields[field.key];
            if (updatedName) {
                field.name = updatedName;
            }
            if (updateData.hidden && !field.required) {
                field.hidden = !!updateData.hidden[field.key];
            }
            if (ordering) {
                field.order = ordering.indexOf(field.key) + 1;
            }
            return field;
        })
        .sort((a, b) => a.order - b.order);

    let r;
    try {
        r = await db.client.collection('lists').updateOne({ _id: listData._id }, updates);
    } catch (err) {
        let error = new Error('Failed to update list, database error');

        error.sourceError = err;
        error.data = updateData;

        throw error;
    }

    if (!r || !r.matchedCount) {
        throw new Error('Failed to update fields');
    }

    return r.matchedCount;
};
