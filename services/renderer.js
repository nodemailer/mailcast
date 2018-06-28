'use strict';

const log = require('npmlog');
const db = require('../lib/db');
const settingsModel = require('../models/settings');

let messageRenderer;
let loopTimeout = false;
let processing = false;

async function loop() {
    let hasMessages = true;
    let settings = await settingsModel.get('global_site_*');

    while (hasMessages) {
        let now = Date.now();

        // try to find an unsent message that is not locked
        let r = await db.client.collection('messages').findOneAndUpdate(
            {
                status: 'queueing',
                draft: false,
                locked: {
                    $lte: now - 3600 * 1000
                }
            },
            {
                $set: {
                    // acquire lock
                    locked: now
                }
            },
            {
                returnOriginal: false
            }
        );

        if (!r || !r.value) {
            // nothing was found, break the loop
            hasMessages = false;
            break;
        }

        processing = r.value;
        await messageRenderer.processMessage(settings, r.value);
    }
}

function runLoop() {
    clearTimeout(loopTimeout);
    processing = true;

    loop()
        .then(() => {
            processing = false;
            loopTimeout = setTimeout(runLoop, 20 * 1000);
        })
        .catch(err => {
            log.error('Renderer/' + process.pid + '/Db', err);
            processing = false;
            loopTimeout = setTimeout(runLoop, 5000);
        });
}

async function main() {
    await db.connect().catch(err => {
        log.error('Renderer/' + process.pid + '/Db', 'Failed to setup database connection. ' + err.message);
        process.exit(2);
    });
    log.info('Renderer/' + process.pid + '/Db', 'Database connection established');

    // redis subscriber to catch new queued messages
    let pubsubsRedis = db.redis.duplicate();
    pubsubsRedis.on('message', (channel, message) => {
        let data = {};
        try {
            data = JSON.parse(message);
        } catch (err) {
            // ignore
        }

        if (channel === 'queue' && data.action === 'new' && !processing) {
            runLoop();
        }
    });

    // need to call *after* db is set up
    messageRenderer = require('../lib/message-renderer');
    await pubsubsRedis.subscribe('queue');

    loopTimeout = setTimeout(runLoop, 1500);
}

main().catch(err => {
    throw err;
});
