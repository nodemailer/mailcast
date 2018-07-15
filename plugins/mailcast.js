'use strict';

const ObjectID = require('mongodb').ObjectID;
const tools = require('../lib/tools');
const mailModel = require('../models/mail');

module.exports.title = 'Mailcast';
module.exports.init = function(app, done) {
    let db = app.db.database;

    if (typeof app.db.database.db === 'function' && app.config.database) {
        db = app.db.database.db(app.config.database);
    }

    app.addHook(
        'sender:connect',
        tools.asyncifyCb(async (delivery, options) => {
            let dkimData;

            try {
                dkimData = await db.collection('settings').findOne({
                    key: 'app_dkim'
                });
            } catch (err) {
                app.logger.error('DKIM', 'DBFAIL error=%s', err.message);
                return;
            }

            if (!dkimData || !dkimData.value || !dkimData.value.privateKey) {
                return;
            }

            let from = delivery.parsedEnvelope.from || '';
            let fromDomain = from.substr(from.lastIndexOf('@') + 1).toLowerCase();

            if (!delivery.dkim.keys) {
                delivery.dkim.keys = [];
            }

            delivery.dkim.keys.push({
                domainName: fromDomain,
                keySelector: dkimData.value.selector,
                privateKey: dkimData.value.privateKey
            });

            if (options.localHostname !== fromDomain) {
                delivery.dkim.keys.push({
                    domainName: options.localHostname,
                    keySelector: dkimData.value.selector,
                    privateKey: dkimData.value.privateKey
                });
            }

            return;
        })
    );

    app.addHook(
        'log:entry',
        tools.asyncifyCb(async entry => {
            if (!entry.from) {
                return;
            }

            let match = (entry.from || '').match(/^bounces\.([a-f0-9]{24})@/i);
            if (!match) {
                return;
            }

            let status;

            switch (entry.action) {
                case 'ACCEPTED':
                    status = 'delivered';
                    break;
                case 'REJECTED':
                    status = entry.category === 'blacklist' ? 'blacklisted' : 'rejected';
                    break;
            }

            try {
                await mailModel.updateStatus({ client: db, redis: app.redis }, new ObjectID(match[1]), status, entry);
            } catch (err) {
                app.logger.error('MTA', 'DBFAIL source=%s email=%s status=%s error=%s', 'MTA', match[1], status, err.message);
            }

            return;
        })
    );

    done();
};
