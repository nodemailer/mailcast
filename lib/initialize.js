'use strict';

const utils = require('util');
const dns = require('dns');
const ipify = require('ipify');
const log = require('npmlog');
const os = require('os');
const db = require('./db');
const settingsModel = require('../models/settings');
const tools = require('./tools');

module.exports = async () => {
    // ensure indexes
    await db.setupIndexes();

    // ensure DKIM settings
    let dkimData = await settingsModel.get('app_dkim');
    if (!dkimData) {
        let dkimData = await tools.generateDkim();
        await settingsModel.set('app_dkim', dkimData);
    }

    let hostname = await settingsModel.get('global_site_hostname');
    if (!hostname) {
        let addr;
        try {
            addr = await ipify();
            let hostnames = await utils.promisify(dns.reverse)(addr);
            if (hostnames && hostnames.length) {
                hostname = hostnames[0];
            }
        } catch (err) {
            log.error('Ipify', 'error=%s', err.message);
            addr = '127.0.0.1';
            hostname = 'localhost';
        }
        hostname = hostname || os.hostname() || addr;
        await settingsModel.set('global_site_hostname', hostname);
    }
};
