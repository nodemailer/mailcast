'use strict';

const express = require('express');
const Joi = require('joi');
const log = require('npmlog');
const pwnedpasswords = require('pwnedpasswords');
const locales = require('../../lib/locales.json');
const tools = require('../../lib/tools');
const timezones = require('../../lib/timezones').timezones;
const userModel = require('../../models/user');
const router = new express.Router();

const localeCodes = locales.map(locale => locale.code);

router.use((req, res, next) => {
    if (/^\/(login|join|recover|reset)\b/.test(req.url)) {
        if (req.user) {
            return res.redirect('/');
        } else {
            return next();
        }
    }

    if (!req.user) {
        req.flash('danger', 'Not logged in');
        return res.redirect('/account/login');
    }

    return next();
});

router.use('/join', (req, res, next) => {
    if (res.locals.disableJoin) {
        let error = new Error('Account signup is currently disabled');
        error.status = 503;
        return next(error);
    }
    next();
});

router.use('/settings', require('./settings/index.js'));

router.get('/logout', (req, res, next) => {
    if (req.user) {
        req.session.regenerate(err => {
            if (err) {
                return next(err);
            }
            req.flash('success', 'You are now logged out');
            res.redirect('/');
        });
    } else {
        return res.redirect('/');
    }
});

router.get('/login', (req, res) => {
    res.render('account/login', {
        page: 'login',
        title: 'Log in',
        values: {},
        errors: {}
    });
});

router.post(
    '/login',
    tools.asyncify(async (req, res) => {
        const schema = Joi.object().keys({
            email: Joi.string()
                .trim()
                .email()
                .label('E-mail Address')
                .required(),
            password: Joi.string()
                .min(8)
                .max(256)
                .label('Password')
                .required(),
            remember: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false)
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

            res.render('account/login', {
                page: 'login',
                title: 'Log in',
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        let user;
        try {
            user = await userModel.authenticate(result.value);
        } catch (err) {
            return showErrors(err);
        }

        if (!user) {
            return showErrors(new Error('Invalid credentials'));
        }

        req.session.regenerate(err => {
            if (err) {
                return showErrors(err);
            }

            if (result.value.remember) {
                // Cookie expires after 30 days
                req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
            } else {
                // Cookie expires at end of session
                req.session.cookie.expires = false;
            }

            req.session.uid = user.toString();

            log.info('Auth', 'LOGINOK user=%s (%s) ip=%s', user, result.value.email, req.ip);

            req.flash('success', 'You are now logged in');
            res.redirect('/lists');
        });
    })
);

router.get('/join', (req, res) => {
    let locals = {
        page: 'join',
        title: 'Join',
        locales,
        timezones,
        values: {
            locale: 'en_US' // default locale
        },
        errors: {}
    };

    res.render('account/join', locals);
});

router.post(
    '/join',
    tools.asyncify(async (req, res) => {
        const schema = Joi.object().keys({
            name: Joi.string()
                .trim()
                .max(256)
                .label('Name'),
            email: Joi.string()
                .trim()
                .email()
                .label('E-mail Address')
                .required(),
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
                .required(),
            e: Joi.string()
                .trim()
                .valid('')
                .required(),
            password: Joi.string()
                .min(8)
                .max(256)
                .label('Password')
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

            res.render('account/join', {
                page: 'join',
                title: 'Join',
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

        result.value.emailValidated = false;

        if (result.value.locale && !localeCodes.includes(result.value.locale)) {
            delete result.value.locale;
        }

        if (result.value.tz && !timezones.includes(result.value.tz)) {
            delete result.value.tz;
        }

        delete result.value.password2;

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

        let user;
        try {
            user = await userModel.create(result.value);
        } catch (err) {
            return showErrors(err);
        }

        req.session.regenerate(err => {
            if (err) {
                return showErrors(err);
            }

            req.session.uid = user.toString();

            log.info('Auth', 'JOINOK user=%s (%s) ip=%s', user, result.value.email, req.ip);

            req.flash('success', 'Account created for ' + result.value.email);
            res.redirect('/lists');
        });
    })
);

router.get(
    '/email-validation',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            email: Joi.string()
                .trim()
                .email()
                .required(),
            token: Joi.string()
                .trim()
                .hex()
                .required()
        });

        const result = Joi.validate(req.query, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        if (result.error) {
            throw result.error;
        }

        let user = await userModel.validateEmail({
            email: result.value.email,
            token: result.value.token
        });

        if (!user) {
            let error = new Error('Unknown user or token');
            error.status = 404;
            return next(error);
        }

        res.render('account/email-validated', {
            user,
            email: result.value.email
        });
    })
);

router.get('/recover', (req, res) => {
    res.render('account/recover', {
        title: 'Account recovery',
        values: {},
        errors: {}
    });
});

router.post(
    '/recover',
    tools.asyncify(async (req, res) => {
        const schema = Joi.object().keys({
            email: Joi.string()
                .trim()
                .email()
                .label('E-mail Address')
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

            res.render('account/recover', {
                title: 'Account recovery',
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        try {
            await userModel.initiateRecovery(result.value);
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'Account recovery code sent');
        res.redirect('/account/recover');
    })
);

router.get(
    '/reset',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            email: Joi.string()
                .trim()
                .email()
                .required(),
            token: Joi.string()
                .trim()
                .hex()
                .required()
        });

        const result = Joi.validate(req.query, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        if (result.error) {
            return next(result.error);
        }

        let userData = await userModel.get({
            email: result.value.email,
            recoveryToken: result.value.token,
            recoveryStarted: { $gte: new Date(Date.now() - 24 * 3600 * 1000) }
        });
        if (!userData) {
            req.flash('danger', 'Unknown or expired recovery token');
            return res.redirect('/');
        }

        res.render('account/reset', {
            title: 'Account recovery',
            values: {
                token: result.value.token,
                email: result.value.email
            },
            errors: {}
        });
    })
);

router.post(
    '/reset',
    tools.asyncify(async (req, res) => {
        const schema = Joi.object().keys({
            email: Joi.string()
                .trim()
                .email()
                .required(),
            token: Joi.string()
                .trim()
                .hex()
                .required(),
            password: Joi.string()
                .min(8)
                .max(256)
                .label('Password')
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

            res.render('account/reset', {
                title: 'Account recovery',
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        let userData = await userModel.get({
            email: result.value.email,
            recoveryToken: result.value.token,
            recoveryStarted: { $gte: new Date(Date.now() - 24 * 3600 * 1000) }
        });

        if (!userData) {
            log.info(process.pid + '/Recovery', 'RECOVERYERR email=%s ip=%s error=Unknown or expired recovery token', result.value.email, req.ip);
            req.flash('danger', 'Unknown or expired recovery token');
            return res.redirect('/');
        }

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
            await userModel.accountRecovery(result.value);
        } catch (err) {
            return showErrors(err);
        }

        req.session.regenerate(err => {
            if (err) {
                // password was already updated, so do not show an unimportant error
                log.error(process.pid + '/Session', err);
                return res.redirect('/');
            }

            req.flash('success', 'Account password updated');
            req.session.uid = userData._id.toString();
            res.redirect('/');
        });
    })
);

module.exports = router;
