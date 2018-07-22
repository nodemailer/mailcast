'use strict';

const express = require('express');
const router = new express.Router();
const tools = require('../lib/tools');
const settingsModel = require('../models/settings');

/* GET home page. */
router.get('/', (req, res) => {
    res.render('index', {
        page: 'home'
    });
});

router.get(
    '/help',
    tools.asyncify(async (req, res) => {
        let siteSettings = await settingsModel.get('global_site_*');
        let dkimData = await settingsModel.get('app_dkim');

        res.render('help', {
            page: 'help',
            title: 'Help',
            dkim: {
                name: dkimData.selector + '._domainkey',
                value: 'v=DKIM1;t=s;p=' + dkimData.publicKey.replace(/^-.*-$/gm, '').replace(/\s/g, '')
            },
            site: siteSettings
        });
    })
);

module.exports = router;
