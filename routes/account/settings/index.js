'use strict';

const express = require('express');
const Joi = require('joi');
const pwnedpasswords = require('pwnedpasswords');
const locales = require('../../../lib/locales.json');
const tools = require('../../../lib/tools');
const timezones = require('../../../lib/timezones').timezones;
const userModel = require('../../../models/user');
const settingsModel = require('../../../models/settings');
const emails = require('../../../lib/emails');
const router = new express.Router();

const localeCodes = locales.map(locale => locale.code);

router.get(
    '/',
    tools.asyncify(async (req, res, next) => {
        let userData = await userModel.get(req.user._id);
        if (!userData) {
            let error = new Error('Failed to find user settings');
            error.status = 404;
            return next(error);
        }

        res.render('account/settings/profile', {
            page: 'settings',
            settingsPage: 'profile',
            title: 'Account settings',
            locales,
            timezones,
            values: userData,
            errors: {}
        });
    })
);

router.post(
    '/profile',
    tools.asyncify(async (req, res) => {
        const schema = Joi.object().keys({
            name: Joi.string()
                .trim()
                .max(256)
                .label('Name'),
            locale: Joi.string()
                .trim()
                .empty('')
                .max(25)
                .label('Locale')
                .required(),
            tz: Joi.string()
                .trim()
                .empty('')
                .max(100)
                .label('Timezone')
        });

        const result = Joi.validate(req.body, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        let showErrors = err => {
            let errors = {};
            let error = false;
            if (err && err.details) {
                err.details.forEach(detail => {
                    if (!errors[detail.path]) {
                        errors[detail.path] = detail.message;
                    }
                });
            } else {
                error = err.message;
            }

            res.render('account/settings/profile', {
                page: 'settings',
                settingsPage: 'profile',
                title: 'Account settings',
                locales,
                timezones,
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        if (result.value.locale && !localeCodes.includes(result.value.locale)) {
            delete result.value.locale;
        }

        if (result.value.tz && !timezones.includes(result.value.tz)) {
            delete result.value.tz;
        }

        try {
            await userModel.update(req.user._id, result.value);
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'Account information updated');
        res.redirect('/account/settings');
    })
);

router.get(
    '/password',
    tools.asyncify(async (req, res, next) => {
        let userData = await userModel.get(req.user._id);

        if (!userData) {
            let error = new Error('Failed to find user settings');
            error.status = 404;
            return next(error);
        }

        res.render('account/settings/password', {
            page: 'settings',
            settingsPage: 'password',
            title: 'Account password',
            values: userData,
            errors: {}
        });
    })
);

router.post(
    '/password',
    tools.asyncify(async (req, res) => {
        const schema = Joi.object().keys({
            existingPassword: Joi.string()
                .min(8)
                .max(256)
                .label('Existing password')
                .required(),
            password: Joi.string()
                .min(8)
                .max(256)
                .label('New password')
                .required(),
            password2: Joi.string()
                .min(8)
                .max(256)
                .label('Password confirmation')
                .valid(Joi.ref('password'))
                .options({
                    language: {
                        any: {
                            allowOnly: '!!Passwords do not match'
                        }
                    }
                })
                .required()
        });

        const result = Joi.validate(req.body, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        let showErrors = err => {
            let errors = {};
            let error = false;
            if (err && err.details) {
                err.details.forEach(detail => {
                    if (!errors[detail.path]) {
                        errors[detail.path] = detail.message;
                    }
                });
            } else {
                error = err.message;
            }

            res.render('account/settings/password', {
                page: 'settings',
                settingsPage: 'password',
                title: 'Account password',
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        let status;
        try {
            status = await userModel.authenticate({
                email: req.user.email,
                password: result.value.existingPassword
            });
        } catch (err) {
            return showErrors(err);
        }

        if (!status) {
            let error = new Error('Failed to validate password');
            error.details = [{ path: 'existingPassword', message: 'Invalid password' }];
            return showErrors(error);
        }

        delete result.value.password2;
        delete result.value.existingPassword;

        try {
            let count = await pwnedpasswords(result.value.password);
            if (count) {
                let error = new Error('Breached password');
                error.details = [{ path: 'password', message: 'This password is not secure' }];
                return showErrors(error);
            }
        } catch (E) {
            // ignore errors, soft check only
        }

        try {
            await userModel.update(req.user._id, result.value);
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'Account password updated');
        res.redirect('/account/settings/password');
    })
);

router.get(
    '/settings',
    tools.asyncify(async (req, res) => {
        let userSettings = await settingsModel.get('global_user_*');
        res.render('users/settings', {
            page: 'users',
            title: 'Settings',
            userPage: 'settings',
            values: userSettings,
            errors: {},
            error: false
        });
    })
);

router.post(
    '/api/resend-validation',
    tools.asyncify(async (req, res) => {
        let userData = await userModel.get(req.user._id);
        if (!userData) {
            return userModel.showJSONErrors(req, res, new Error('Failed to load user data'));
        }

        if (!userData.emailValidated) {
            setImmediate(() => emails.emailValidation(userData).catch(() => false));
        }

        res.json({
            success: true,
            email: userData.email
        });
    })
);

router.use((req, res, next) => {
    if (/^\/(site)\b/.test(req.url)) {
        return next();
    }

    if (req.user.status !== 'admin') {
        let error = new Error('No permissions to access this page');
        error.status = 404;
    }
    next();
});

router.get(
    '/site',
    tools.asyncify(async (req, res) => {
        let siteSettings = await settingsModel.get('global_site_*');
        let dkimData = await settingsModel.get('app_dkim');

        res.render('account/settings/site', {
            page: 'settings',
            settingsPage: 'site',
            title: 'Site settings',
            dkim: {
                name: dkimData.selector + '._domainkey',
                value: 'v=DKIM1;t=s;p=' + dkimData.publicKey.replace(/^-.*-$/gm, '').replace(/\s/g, '')
            },
            hasUpdates: await settingsModel.getUpdates(),
            values: siteSettings,
            errors: {},
            error: false
        });
    })
);

router.post(
    '/site',
    tools.asyncify(async (req, res) => {
        const schema = Joi.object().keys({
            global_site_appName: Joi.string()
                .trim()
                .max(256)
                .label('Application name'),
            global_site_hostname: Joi.string()
                .trim()
                .empty('')
                .hostname()
                .max(1024)
                .label('Application hostname'),
            global_site_baseUrl: Joi.string()
                .trim()
                .empty('')
                .uri()
                .max(1024)
                .label('Application URL'),
            resetDkim: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false),
            global_site_recaptchaEnabled: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false),
            global_site_recaptchaSiteKey: Joi.string()
                .empty('')
                .trim()
                .max(256)
                .label('Recaptcha Site Key')
                .when('global_site_recaptchaEnabled', {
                    is: Joi.equal(true),
                    then: Joi.required()
                }),
            global_site_recaptchaSecretKey: Joi.string()
                .empty('')
                .trim()
                .max(256)
                .label('Recaptcha Secret Key')
                .when('global_site_recaptchaEnabled', {
                    is: Joi.equal(true),
                    then: Joi.required()
                })
        });

        const result = Joi.validate(req.body, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        let showErrors = async err => {
            let errors = {};
            let error = false;
            if (err && err.details) {
                err.details.forEach(detail => {
                    let path = detail.path;
                    if (Array.isArray(path)) {
                        path = path.pop();
                    }
                    if (!errors[path]) {
                        errors[path] = detail.message;
                    }
                });
            } else {
                error = err.message;
            }

            let dkimData = await settingsModel.get('app_dkim');

            res.render('account/settings/site', {
                page: 'settings',
                settingsPage: 'site',
                title: 'Site settings',
                dkim: {
                    name: dkimData.selector + '._domainkey',
                    value: 'v=DKIM1;t=s;p=' + dkimData.publicKey.replace(/^-.*-$/gm, '').replace(/\s/g, '')
                },
                hasUpdates: await settingsModel.getUpdates(),
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        if (result.value.resetDkim) {
            result.value.app_dkim = await tools.generateDkim();
        }

        delete result.value.resetDkim;

        await settingsModel.setMulti(result.value);

        req.flash('success', 'Site settings updated');
        res.redirect('/account/settings/site');
    })
);

router.post(
    '/site/api/upgrade',
    tools.asyncify(async (req, res) => {
        process.send({ cmd: 'siteUpgrade' });
        res.json({
            success: true
        });
    })
);

module.exports = router;
