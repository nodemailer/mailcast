'use strict';

const config = require('wild-config');
const utils = require('util');
const dns = require('dns');
const ipify = require('ipify');
const log = require('npmlog');
const os = require('os');
const db = require('./db');
const settingModel = require('../models/settings');
const tools = require('./tools');

module.exports = async () => {
    // ensure indexes
    await db.setupIndexes();

    // ensure DKIM settings
    let dkimData = await settingModel.get('app_dkim');
    if (!dkimData) {
        let dkimData = await tools.generateDkim();
        await settingModel.set('app_dkim', dkimData);
    }

    let hostname = await settingModel.get('global_site_hostname');
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
        await settingModel.set('global_site_hostname', hostname);
    }

    let baseUrl = await settingModel.get('global_site_baseUrl');
    if (!baseUrl) {
        await settingModel.set('global_site_baseUrl', 'http://' + hostname + (config.www.port !== 80 ? ':' + config.www.port : ''));
    }
};
