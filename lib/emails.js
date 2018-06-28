'use strict';

const URL = require('url').URL;
const mailer = require('./mailer');
const settingsModel = require('../models/settings');
const mailModel = require('../models/mail');

module.exports.emailValidation = async userData => {
    let settings = await settingsModel.get('global_site_*');

    let locals = {
        appname: settings.global_site_appName,
        appurl: settings.global_site_baseUrl,
        userData
    };

    let url = new URL('account/email-validation', locals.appurl);
    url.searchParams.append('email', userData.email);
    url.searchParams.append('token', userData.emailToken);
    locals.validationUrl = url.href;

    let template = 'email-validation';
    let mail = await mailModel.create({
        user: userData._id,
        type: 'transactional',
        template,
        to: userData.email
    });

    let info = await mailer.send({
        _id: mail._id,
        id: mail.id,
        userId: userData._id, // for logs
        template,
        zone: 'default',
        message: {
            envelope: {
                from: ['bounces', mail._id].join('.') + '@' + settings.global_site_hostname,
                to: userData.email
            },
            to: userData.email
        },
        locals
    });

    return info;
};

module.exports.welcome = async userData => {
    let settings = await settingsModel.get('global_site_*');

    let locals = {
        appname: settings.global_site_appName,
        appurl: settings.global_site_baseUrl,
        userData
    };

    let url = new URL('account/login', locals.appurl);
    locals.loginUrl = url.href;

    let template = 'welcome';
    let mail = await mailModel.create({
        user: userData._id,
        type: 'transactional',
        template,
        to: userData.email
    });

    let info = await mailer.send({
        _id: mail._id,
        id: mail.id,
        userId: userData._id, // for logs
        template,
        zone: 'default',
        message: {
            envelope: {
                from: ['bounces', mail._id].join('.') + '@' + settings.global_site_hostname,
                to: userData.email
            },
            to: userData.email
        },
        locals
    });

    return info;
};

module.exports.accountRecovery = async userData => {
    let settings = await settingsModel.get('global_site_*');

    let locals = {
        appname: settings.global_site_appName,
        appurl: settings.global_site_baseUrl,
        userData
    };

    let url = new URL('account/reset', locals.appurl);
    url.searchParams.append('email', userData.email);
    url.searchParams.append('token', userData.recoveryToken);
    locals.recoveryUrl = url.href;

    let template = 'account-recovery';
    let mail = await mailModel.create({
        user: userData._id,
        type: 'transactional',
        template,
        to: userData.email
    });

    let info = await mailer.send({
        _id: mail._id,
        id: mail.id,
        userId: userData._id, // for logs
        template,
        zone: 'default',
        message: {
            envelope: {
                from: ['bounces', mail._id].join('.') + '@' + settings.global_site_hostname,
                to: userData.email
            },
            to: {
                name: userData.name,
                address: userData.email
            }
        },
        locals
    });

    return info;
};

module.exports.emailSubscriberConfirmation = async (listData, subscriberData) => {
    let settings = await settingsModel.get('global_site_*');

    let locals = {
        appname: settings.global_site_appName,
        appurl: settings.global_site_baseUrl,
        listData,
        subscriberData
    };

    let url = new URL('subscribers/confirm', locals.appurl);
    url.searchParams.append('s', subscriberData._id);
    url.searchParams.append('t', subscriberData.confirmToken);
    locals.validationUrl = url.href;

    let template = 'subscriber-confirm';
    let mail = await mailModel.create({
        user: listData.user,
        subscriber: subscriberData._id,
        type: 'transactional',
        template,
        to: subscriberData.email
    });

    let info = await mailer.send({
        _id: mail._id,
        id: mail.id,
        userId: subscriberData._id, // for logs
        template,
        zone: 'default',
        message: {
            envelope: {
                from: ['bounces', mail._id].join('.') + '@' + settings.global_site_hostname,
                to: subscriberData.email
            },
            from: {
                name: listData.name,
                address: listData.email
            },
            to: {
                name: subscriberData.name,
                address: subscriberData.email
            }
        },
        locals
    });

    return info;
};

module.exports.emailChangeConfirmation = async (listData, subscriberData) => {
    let settings = await settingsModel.get('global_site_*');

    let locals = {
        appname: settings.global_site_appName,
        appurl: settings.global_site_baseUrl,
        listData,
        subscriberData
    };

    let url = new URL('subscribers/change', locals.appurl);
    url.searchParams.append('s', subscriberData._id);
    url.searchParams.append('t', subscriberData.confirmToken);
    locals.validationUrl = url.href;

    let template = 'subscriber-change';
    let mail = await mailModel.create({
        user: listData.user,
        subscriber: subscriberData._id,
        type: 'transactional',
        template,
        to: subscriberData.email
    });

    let info = await mailer.send({
        _id: mail._id,
        id: mail.id,
        userId: subscriberData._id, // for logs
        template,
        zone: 'default',
        message: {
            envelope: {
                from: ['bounces', mail._id].join('.') + '@' + settings.global_site_hostname,
                to: subscriberData.email
            },
            from: {
                name: listData.name,
                address: listData.email
            },
            to: {
                name: subscriberData.name,
                address: subscriberData.tempEmail
            }
        },
        locals
    });

    return info;
};
