'use strict';

const ObjectID = require('mongodb').ObjectID;
const config = require('wild-config');
const log = require('npmlog');
const Baunsu = require('baunsu');
const SMTPServer = require('smtp-server').SMTPServer;
const tools = require('../lib/tools');
const db = require('../lib/db');

const logger = {};
['trace', 'debug', 'info', 'warn', 'error', 'fatal'].forEach(level => {
    logger[level] = (entry, message, ...args) => {
        switch (level) {
            case 'debug':
                level = 'verbose';
                break;
        }
        log[level]('VERP', message, ...args);
    };
});

async function main() {
    await db.connect().catch(err => {
        log.error('VERP/' + process.pid + '/Db', 'Failed to setup database connection. ' + err.message);
        process.exit(2);
    });

    log.info('VERP/' + process.pid + '/Db', 'Database connection established');

    // these modules require db to be set up
    const settingsModel = require('../models/settings');
    const mailModel = require('../models/mail');

    // Setup server
    const server = new SMTPServer({
        // log to console
        logger,

        name: await settingsModel.get('global_site_hostname'),

        banner: config.appname + ' VERP bouncer',

        disabledCommands: ['AUTH', 'STARTTLS'],

        onRcptTo: tools.asyncifyCb(async (addr, session) => {
            let address = tools.normalizeEmail(addr.address);

            log.info('VERP', '%s RCPT from=%s to=%s', session.id, tools.normalizeEmail(session.envelope.mailFrom.address), address);

            let match = (address || '').match(/^bounces\.([a-f0-9]{24})@/i);
            if (!match) {
                return;
            }

            let email = new ObjectID(match[1]);
            let mailData = await mailModel.get(email);
            if (!session.emails) {
                session.emails = [];
            }
            if (mailData) {
                session.emails.push(mailData);
            }

            return;
        }),

        // Handle message stream
        onData: (stream, session, callback) => {
            let chunks = [];
            let chunklen = 0;

            stream.on('readable', () => {
                let chunk;
                while ((chunk = stream.read()) !== null) {
                    if (chunk && chunk.length && chunklen < 128 * 1024) {
                        chunks.push(chunk);
                        chunklen += chunk.length;
                    }
                }
            });

            stream.on(
                'end',
                tools.asyncifyCb(async () => {
                    let body = Buffer.concat(chunks, chunklen);

                    let bounceResult;

                    try {
                        let bounce = new Baunsu();
                        bounceResult = bounce.detectSync(body);
                    } catch (err) {
                        log.error('Bounce', 'Failed parsing bounce message. error=%s body=%s', err.message, Buffer.byteLength(body));
                        // accept to prevent resending this message
                        return callback(null, 'Message accepted');
                    }

                    if (bounceResult && bounceResult.isHard()) {
                        let responseMessage = (bounceResult.diagnosticCodes && bounceResult.diagnosticCodes.pop()) || 'MX';

                        for (let mailData of session.emails) {
                            try {
                                await mailModel.updateStatus(db, mailData._id, 'bounced', { action: 'bounced', response: responseMessage });
                            } catch (err) {
                                log.error('VERP', 'DBFAIL source=%s email=%s status=%s error=%s', 'MX', mailData._id, 'BOUNCED', err.message);
                            }
                        }
                    }

                    return callback(null, 'Message accepted');
                })
            );
        }
    });

    let started = false;

    server.on('error', err => {
        const port = config.verp.port;
        const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;

        switch (err.code) {
            case 'EACCES':
                log.error('VERP', '%s requires elevated privileges', bind);
                break;
            case 'EADDRINUSE':
                log.error('VERP', '%s is already in use', bind);
                break;
            case 'ECONNRESET': // Usually happens when a client does not disconnect cleanly
            case 'EPIPE': // Remote connection was closed before the server attempted to send data
            default:
                log.error('VERP', err); // just log the message and continue
                return;
        }

        process.exit(45);
    });

    let hosts;
    if (typeof config.verp.host === 'string' && config.verp.host) {
        hosts = config.verp.host
            .trim()
            .split(',')
            .map(host => host.trim())
            .filter(host => host.trim());
        if (hosts.indexOf('*') >= 0 || hosts.indexOf('all') >= 0) {
            hosts = [false];
        }
    } else {
        hosts = [false];
    }

    for (let host of hosts) {
        await server.listen(config.verp.port, host);
        if (started) {
            // error
            return server.close();
        }
    }

    started = true;
    return true;
}

main().catch(err => {
    throw err;
});
