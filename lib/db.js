/* eslint no-await-in-loop: 0 */

'use strict';

const config = require('wild-config');
const yaml = require('js-yaml');
const fs = require('fs');
const log = require('npmlog');
const pathlib = require('path');
const setupIndexes = yaml.safeLoad(fs.readFileSync(pathlib.join(__dirname, '..', 'setup', 'indexes.yaml'), 'utf8'));
const mongodb = require('mongodb');
const Redis = require('ioredis');

const MongoClient = mongodb.MongoClient;

module.exports.redis = new Redis(config.dbs.redis);
module.exports.client = false;
module.exports.amqpConnection = false;
module.exports.amqp = false;
module.exports.gridfs = false;
module.exports.senderDb = false;

module.exports.connect = async () => {
    // Apsplication DB
    const client = await MongoClient.connect(config.dbs.mongo, { useNewUrlParser: true });
    const db = (module.exports.client = client.db(config.dbs.database));

    // DB for minimta
    if (config.dbs.sender && config.dbs.sender !== config.dbs.database) {
        module.exports.senderDb = client.db(config.dbs.sender);
    } else {
        module.exports.senderDb = db;
    }

    return db;
};

module.exports.setupIndexes = async () => {
    // setup indexes
    for (let i = 0; i < setupIndexes.indexes.length; i++) {
        let index = setupIndexes.indexes[i];
        try {
            await module.exports.client.collection(index.collection).createIndexes([index.index]);
        } catch (err) {
            log.error(process.pid + '/Mongo', 'Failed creating index %s %s. %s', i, JSON.stringify(index.collection + '.' + index.index.name), err.message);
        }
    }
};
