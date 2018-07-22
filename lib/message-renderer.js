'use strict';

const log = require('npmlog');
const mailModel = require('../models/mail');
const messageModel = require('../models/message');
const URL = require('url').URL;
const mailer = require('./mailer');
const htmlToText = require('html-to-text');
const juice = require('juice');
const mimeFuncs = require('nodemailer/lib/mime-funcs');
const templateModel = require('../models/template');
const settingsModel = require('../models/settings');
const db = require('./db');
const Handlebars = require('handlebars');

let render = async options => {
    let locals = {};

    Object.keys(options.subscriberData.fields).forEach(key => {
        locals[key] = options.subscriberData.fields[key];
    });

    let listData = options.listData;
    let subscriberData = options.subscriberData;
    let messageData = options.messageData;

    locals.NAME = subscriberData.name;
    locals.SUBJECT = messageData.subject;

    ///subscribers/edit/5b2a0f41c0015570bc770def
    /// http://host29.guest.zone.eu:3002/subscribers/unsubscribe/5b2a0f41c0015570bc770def
    locals.PREFERENCES_URL = new URL('subscribers/edit/' + subscriberData._id, options.appurl).href;
    locals.UNSUBSCRIBE_URL = new URL('subscribers/unsubscribe/' + subscriberData._id, options.appurl).href;

    let url = new URL('archive/' + listData._id + '/view/' + messageData._id, options.appurl);
    url.searchParams.append('s', subscriberData._id);
    locals.ARCHIVED_URL = url.href;

    let mail = await mailModel.create({
        user: listData.user,
        message: messageData._id,
        subscriber: subscriberData._id,
        type: 'list',
        to: subscriberData.email,
        testRun: options.testRun
    });

    let verpAddress = ['bounces', mail._id].join('.') + '@' + options.hostname;
    let email = {
        envelope: {
            from: verpAddress,
            to: subscriberData.email
        },

        from: {
            name: listData.name,
            address: listData.email
        },

        to: {
            name: subscriberData.name,
            address: subscriberData.email
        },

        sender: {
            name: listData.name,
            address: verpAddress
        },

        headers: {
            'x-fbl': mail._id.toString(),
            'List-ID': {
                prepared: true,
                value: mimeFuncs.encodeWords(listData.name, false, false, true) + ' <' + listData._id + '.' + options.hostname + '>'
            },
            'List-Unsubscribe': {
                prepared: true,
                value: '<' + locals.UNSUBSCRIBE_URL.replace(/\s+/g, '+') + '>'
            },
            Precedence: 'bulk',
            'X-Mailer': options.appname + ' (+ ' + options.appurl + ')',
            'X-Auto-Response-Suppress': 'OOF, AutoReply'
        },

        subject: options.subjectTemplate(locals)
    };

    locals.CONTENTS = options.htmlTemplate(locals);
    let html = options.layoutTemplate(locals);
    if (html) {
        try {
            // might explode on long or strange strings
            email.text = htmlToText.fromString(html);
        } catch (E) {
            // ignore
        }
    }

    if (!messageData.textOnly) {
        email.html = juice(html);
    }

    let info = await mailer.send({
        _id: mail._id,
        id: mail.id,
        userId: listData.user, // for logs
        zone: 'lists',
        encryptionKey: subscriberData.keyInfo && subscriberData.keyInfo.key,
        message: email
    });

    try {
        // increase daily and monthly send counters for this user
        let counter = await db.redis
            .multi()
            .hincrby('emails:' + listData.user, new Date().toISOString().substr(0, 10), 1)
            .hincrby('emails:' + listData.user, new Date().toISOString().substr(0, 7), 1)
            .exec();

        log.info(
            'Renderer',
            'COUNTER user=%s day=%s month=%s',
            listData.user,
            (counter && counter[0] && counter[0][1]) || '-',
            (counter && counter[1] && counter[1][1]) || '-'
        );
    } catch (err) {
        log.error('Redis', 'user=%s action=%s error=%s', listData.user, 'queue', err.message);
    }

    if (!options.testRun) {
        // only increase status counters if not in test run
        try {
            await messageModel.update(
                messageData._id,
                {
                    $inc: {
                        'counters.queued': 1
                    }
                },
                { publish: true }
            );
        } catch (err) {
            log.error('Renderer', err);
            // ignore
        }
    }

    return info;
};

module.exports.processMessage = async (settings, messageData, testRun) => {
    if (!settings) {
        settings = await settingsModel.get('global_site_*');
    }

    let listData = await db.client.collection('lists').findOne({ _id: messageData.list });
    if (!listData) {
        if (testRun) {
            // do nothing if this is a test run
            return;
        }
        // can't do much without list entry
        await db.client.collection('messages').updateOne(
            { _id: messageData._id },
            {
                $set: {
                    status: 'sent',
                    locked: 0
                }
            },
            {
                returnOriginal: false
            }
        );
        return;
    }
    let templateData = await templateModel.get(messageData.template, false, { allowDefault: true });
    let layoutTemplate = Handlebars.compile((templateData && templateData.code) || '{{{CONTENTS}}}');
    let htmlTemplate = Handlebars.compile((messageData.editordata && messageData.editordata.html) || '');
    let subjectTemplate = Handlebars.compile(messageData.subject || '');

    let subscriberQuery = {
        list: listData._id,
        status: 'subscribed'
    };

    if (!testRun && messageData.lastProcessedId) {
        subscriberQuery._id = {
            $gt: messageData.lastProcessedId
        };
    } else if (testRun) {
        // on test run only look for subscribers with the test flag set
        subscriberQuery.testSubscriber = true;
    }

    let hasSubscribers = true;
    let cursor = db.client
        .collection('subscribers')
        .find(subscriberQuery)
        .sort({ _id: 1 });

    while (hasSubscribers) {
        let subscriberData = await cursor.next();
        if (!subscriberData) {
            hasSubscribers = false;
            break;
        }

        try {
            if (!testRun) {
                // store current subscriber id, so we do not send to this subscriber again if process gets restarted
                // not relevant in test run
                await db.client.collection('messages').updateOne({ _id: messageData._id }, { $set: { lastProcessedId: subscriberData._id } });
            }

            await render({
                appname: settings.global_site_appName,
                appurl: settings.global_site_baseUrl,
                hostname: settings.global_site_hostname,
                layoutTemplate,
                htmlTemplate,
                subjectTemplate,
                listData,
                messageData,
                subscriberData,
                testRun: !!testRun
            });
        } catch (err) {
            log.error('Renderer/' + process.pid, 'subscriber=% error=%s', subscriberData._id, err.message);
            continue;
        }
    }

    try {
        // make sure cursor gets closed
        await cursor.close();
    } catch (err) {
        // ignore
    }

    if (testRun) {
        // do not update message status on test run
        return;
    }

    try {
        let r = await db.client.collection('messages').findOneAndUpdate(
            { _id: messageData._id },
            {
                $set: {
                    status: 'sent',
                    locked: 0
                }
            },
            {
                returnOriginal: false,
                projection: {
                    status: true,
                    counters: true
                }
            }
        );

        if (r && r.value) {
            db.redis.publish('mailcast.' + r.value._id, JSON.stringify(r.value));
        }
    } catch (err) {
        log.error('Renderer/' + process.pid, 'error=%s', err.message);
    }
};
