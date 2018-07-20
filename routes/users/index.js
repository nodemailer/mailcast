'use strict';

const express = require('express');
const Joi = require('joi');
const tools = require('../../lib/tools');
const userModel = require('../../models/user');
const settingsModel = require('../../models/settings');
const router = new express.Router();
const locales = require('../../lib/locales.json');
const timezones = require('../../lib/timezones').timezones;
const localeCodes = locales.map(locale => locale.code);
const moment = require('moment-timezone');
const generatePassword = require('generate-password');

const statuses = [
    {
        name: 'Normal user',
        key: 'user'
    },
    {
        name: 'Admin user',
        key: 'admin'
    }
];

const statusKeys = statuses.map(status => status.key);

router.use(
    tools.asyncify(async (req, res, next) => {
        if (!req.user) {
            req.flash('danger', 'You need to be logged in to access restricted pages');
            return res.redirect('/account/login');
        }

        if (req.user.status !== 'admin') {
            let error = new Error('No permissions to access resticted page');
            error.status = 403;
            throw error;
        }

        next();
    })
);

router.get(
    '/',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            page: Joi.number()
                .min(0)
                .label('Page')
                .default(1),
            limit: Joi.number()
                .min(0)
                .max(100)
                .label('Limit')
                .default(30),
            query: Joi.string()
                .trim()
                .empty('')
                .max(256)
                .label('Query')
        });

        req.query.list = req.params.list;
        const result = Joi.validate(req.query, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        if (result.error) {
            return next(result.error);
        }

        let { users, total, page, pages } = await userModel.list(result.value.page, result.value.limit, result.value.query);

        let url = new URL('users', res.locals.appurl);
        url.searchParams.append('paging', 'true'); // make sure we have at least one query argument

        if (result.value.limit) {
            url.searchParams.append('limit', result.value.limit);
        }

        if (result.value.query) {
            url.searchParams.append('query', result.value.query);
        }

        moment.locale((req.user.locale || 'en').replace(/_/g, '-'));
        users = users.map((userData, i) => {
            userData.nr = (page - 1) * result.value.limit + i + 1;
            userData.createdStr = moment(userData.created)
                .tz(req.user.tz || 'UTC')
                .format('LLL');
            return userData;
        });
        moment.locale(false);

        res.render('users/index', {
            page: 'users',
            title: 'Users',
            userPage: 'list',
            list: result.value.list,
            query: result.value.query || '',
            pagingUrl: url.pathname + url.search + '&page=%s',
            curpage: page,
            pages,
            users,
            total,
            error: false
        });
    })
);

router.get(
    '/add',
    tools.asyncify(async (req, res) => {
        res.render('users/add', {
            page: 'users',
            title: 'Add new user',
            userPage: 'manage',
            locales,
            timezones,
            statuses,
            values: {
                locale: req.user.locale,
                tz: req.user.tz,
                status: 'user'
            },
            errors: {},
            error: false
        });
    })
);

router.post(
    '/add',
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
            status: Joi.string()
                .trim()
                .empty('')
                .max(100)
                .label('Status')
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

            res.render('users/add', {
                page: 'users',
                title: 'Add new user',
                userPage: 'manage',
                locales,
                timezones,
                statuses,
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        result.value.emailValidated = true;

        if (result.value.locale && !localeCodes.includes(result.value.locale)) {
            delete result.value.locale;
        }

        if (result.value.tz && !timezones.includes(result.value.tz)) {
            delete result.value.tz;
        }

        if (result.value.status && !statusKeys.includes(result.value.status)) {
            delete result.value.status;
        }

        result.value.password = generatePassword.generate({
            length: 14,
            uppercase: true,
            numbers: true,
            symbols: false
        });

        let user;
        try {
            user = await userModel.create(result.value);
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'Account created for ' + result.value.email);
        res.redirect('/users?user=' + user);
    })
);

router.get(
    '/edit/:user',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required()
        });

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        if (result.error) {
            return next(result.error);
        }

        if (result.value.user === req.user._id.toString()) {
            return res.redirect('/account/settings');
        }

        let userData = await userModel.get(result.value.user);
        if (!userData) {
            let error = new Error('User not found');
            error.status = 404;
            throw error;
        }

        res.render('users/edit', {
            page: 'users',
            title: 'Edit user',
            userPage: 'manage',
            locales,
            timezones,
            statuses,
            userData,
            values: userData,
            errors: {},
            error: false
        });
    })
);

router.post(
    '/edit',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
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
            status: Joi.string()
                .trim()
                .empty('')
                .max(100)
                .label('Status')
        });

        const result = Joi.validate(req.body, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        let userData;

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

            if (errors.user) {
                return next(err);
            }

            if (!userData) {
                userData = await userModel.get(result.value.user);
            }

            if (!userData) {
                let error = new Error('User not found');
                error.status = 404;
                throw error;
            }

            res.render('users/edit', {
                page: 'users',
                title: 'Edit user',
                userPage: 'manage',
                locales,
                timezones,
                statuses,
                userData,
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        if (result.value.user === req.user._id.toString()) {
            req.flash('danger', 'Can not modify own account');
            return res.redirect('/account/settings');
        }

        userData = await userModel.get(result.value.user);
        if (!userData) {
            let error = new Error('User not found');
            error.status = 404;
            throw error;
        }

        if (result.value.locale && !localeCodes.includes(result.value.locale)) {
            delete result.value.locale;
        }

        if (result.value.tz && !timezones.includes(result.value.tz)) {
            delete result.value.tz;
        }

        if (result.value.status && !statusKeys.includes(result.value.status)) {
            delete result.value.status;
        }

        try {
            await userModel.update(result.value.user, result.value, { allowEmailChange: true });
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'User data updated');
        res.redirect('/users/edit/' + result.value.user);
    })
);

router.post(
    '/delete',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required()
        });

        const result = Joi.validate(req.body, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        if (result.error) {
            return next(result.error);
        }

        if (result.value.user === req.user._id.toString()) {
            req.flash('danger', 'Can not delete own account');
            return res.redirect('/account/settings');
        }

        let userData = await userModel.get(result.value.user);

        if (!userData) {
            let error = new Error('User not found');
            error.status = 404;
            throw error;
        }

        let success = await userModel.delete(result.value.user);

        if (success) {
            req.flash('success', 'User deleted');
        }

        res.redirect('/users');
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
    '/settings',
    tools.asyncify(async (req, res) => {
        const schema = Joi.object().keys({
            global_user_disableJoin: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false)
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

            res.render('users/settings', {
                page: 'users',
                title: 'Settings',
                userPage: 'settings',
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        await settingsModel.setMulti(result.value);

        req.flash('success', 'Settings updated');
        res.redirect('/users/settings');
    })
);

module.exports = router;
