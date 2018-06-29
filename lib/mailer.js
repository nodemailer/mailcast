'use strict';

const config = require('wild-config');
const nodemailer = require('nodemailer');
const Email = require('email-templates');
const path = require('path');
const log = require('npmlog');
const Maildrop = require('./maildrop');
const db = require('./db');
const MailComposer = require('nodemailer/lib/mail-composer');
const mailModel = require('../models/mail');
const settingsModel = require('../models/settings');
const Encrypter = require('nodemailer-openpgp').Encrypter;

const maildrop = new Maildrop({
    db,
    zone: 'default', // can be overriden per message
    collection: config.mta.queue.collection,
    gfs: config.mta.queue.gfs
});

let transport;

settingsModel.get('global_site_*').then(settings => {
    transport = nodemailer.createTransport(
        {
            jsonTransport: true,
            skipEncoding: true
        },
        {
            from: 'no-reply@' + settings.global_site_hostname
        }
    );
});

const email = new Email({
    views: {
        root: path.resolve(__dirname, '..', 'views', 'emails')
    },
    // <https://github.com/Automattic/juice>
    juice: true,
    juiceResources: {
        preserveImportant: true,
        webResources: {
            relativeTo: path.resolve(__dirname, '..', 'public')
        }
    },
    htmlToText: false,
    send: true,
    preview: false,
    transport
});

module.exports = {
    transport,
    send: async mailData => {
        if (!transport) {
            throw new Error('Mail transport not yet initialized');
        }
        try {
            let info;
            try {
                if (mailData.userId) {
                    mailData.message.headers = mailData.message.headers || {};
                    mailData.message.headers['X-Minimail-UserId'] = mailData.userId.toString();
                }

                if (mailData.template) {
                    info = await email.send(mailData);
                } else {
                    info = await transport.sendMail(mailData.message);
                }
            } catch (err) {
                log.info(
                    process.pid + '/email',
                    '%s MAILERR template=%s to=%s error=%s',
                    mailData.userId,
                    mailData.template || '',
                    mailData.message.to.address || mailData.message.to,
                    err.message
                );
                throw err;
            }

            if (!info.message.text && !info.message.html) {
                info.message.text = '<empty message>';
            }

            info.message.envelope = info.envelope || info.message.envelope;

            let compiler = new MailComposer(info.message);
            let compiled = compiler.compile();
            let compiledEnvelope = compiled.getEnvelope();

            return await new Promise((resolve, reject) => {
                let message = maildrop.push(
                    {
                        id: mailData.id,
                        reason: 'submit',
                        from: compiledEnvelope.from,
                        to: compiledEnvelope.to,
                        sendTime: new Date(),
                        zone: mailData.zone
                    },
                    (err, ...args) => {
                        if (err || !args[0]) {
                            if (err) {
                                err.code = err.code || 'ERRCOMPOSE';
                            }
                            log.info(
                                process.pid + '/email',
                                '%s MAILERR template=%s to=%s error=%s',
                                mailData.userId,
                                mailData.template || '',
                                mailData.message.to.address || mailData.message.to,
                                err.message
                            );

                            mailModel
                                .update(mailData._id, {
                                    status: 'errored',
                                    messageId: info.messageId,
                                    from: compiledEnvelope.from,
                                    sender: info.message.from || { address: compiledEnvelope.from },
                                    $push: {
                                        log: {
                                            action: 'ERROR',
                                            error: err.message,
                                            created: new Date()
                                        }
                                    }
                                })
                                .then(() => false)
                                .catch(() => false);

                            return setImmediate(() => reject(err));
                        }

                        log.info(
                            process.pid + '/email',
                            '%s QUEUED template=%s to=%s message-id=%s',
                            mailData.userId,
                            mailData.template || '',
                            mailData.message.to.address || mailData.message.to,
                            info.messageId
                        );

                        if (mailData._id) {
                            mailModel
                                .update(mailData._id, {
                                    status: 'queued',
                                    messageId: info.messageId,
                                    from: compiledEnvelope.from,
                                    sender: info.message.from || { address: compiledEnvelope.from },
                                    $push: {
                                        log: {
                                            action: 'QUEUED',
                                            created: new Date()
                                        }
                                    }
                                })
                                .then(() => false)
                                .catch(err => {
                                    log.error(
                                        process.pid + '/email',
                                        '%s MAILERR template=%s to=%s error=%s',
                                        mailData.userId,
                                        mailData.template || '',
                                        mailData.message.to.address || mailData.message.to,
                                        err.message
                                    );
                                });
                        }

                        return setImmediate(() => resolve(args[0].id));
                    }
                );

                if (message) {
                    let stream = compiled.createReadStream();
                    stream.once('error', err => message.emit('error', err));

                    if (mailData.encryptionKey) {
                        let encrypter = new Encrypter({
                            /*
                            // TODO: use signing key
                            signingKey,
                            passphrase,
                            */
                            encryptionKeys: [mailData.encryptionKey]
                        });
                        encrypter.once('error', err => message.emit('error', err));
                        stream.pipe(encrypter).pipe(message);
                    } else {
                        stream.pipe(message);
                    }
                }
            });
        } catch (err) {
            log.error(
                process.pid + '/email',
                '%s MAILERR template=%s to=%s error=%s',
                mailData.userId,
                mailData.template || '',
                mailData.message.to.address || mailData.message.to,
                err.message
            );
            throw err;
        }
    }
};
