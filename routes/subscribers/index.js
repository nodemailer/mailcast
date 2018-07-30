'use strict';

const express = require('express');
const Joi = require('joi');
const tools = require('../../lib/tools');
const listModel = require('../../models/list');
const subscriberModel = require('../../models/subscriber');
const timezones = require('../../lib/timezones').timezones;
const router = new express.Router();

router.use((req, res, next) => {
    req.errorTemplate = 'subscribers/error';
    next();
});

router.get(
    '/confirm',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            s: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .label('Subscription token')
                .required(),
            t: Joi.string()
                .hex()
                .lowercase()
                .length(20)
                .label('Confirmation token')
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

        let subscriberData = await subscriberModel.get(result.value.s, true);

        if (!subscriberData) {
            let error = new Error('Invalid or expired confirmation token, please resubscribe');
            error.status = 404;
            throw error;
        }

        let listData = await listModel.get(subscriberData.list);

        if (subscriberData.parent) {
            // move pending data over to actual subscriber record
            subscriberData = await subscriberModel.activatePending(subscriberData);
        }

        if (subscriberData.status === 'unconfirmed') {
            if (!subscriberData.confirmToken || subscriberData.confirmToken !== result.value.t) {
                let error = new Error('Invalid or expired confirmation token, please resubscribe');
                error.status = 403;
                throw error;
            }

            await subscriberModel.update(subscriberData._id, {
                status: 'subscribed'
            });
        }

        res.render('subscribers/confirm', {
            page: 'subscribers',
            title: 'Subscription confirmed',
            subscriber: subscriberData._id,
            subscriberData,
            listData
        });
    })
);

router.get(
    '/subscribe/:list',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            list: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .label('List ID')
                .required()
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

        let listData = await listModel.get(result.value.list);

        result.value.fields = {};

        res.render('subscribers/subscribe', {
            page: 'subscribers',
            title: 'Subscribe',
            listData,
            list: listData._id,
            values: result.value,
            fields: listData.fields,
            errors: {},
            error: false
        });
    })
);

router.post(
    '/subscribe',
    tools.recaptchaVerify,
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            list: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .label('List ID')
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
            fields: Joi.object()
                .pattern(
                    /^(?:FNAME|LNAME|MERGE\d{3,10})$/,
                    Joi.string()
                        .trim()
                        .allow('')
                        .max(256)
                )
                .pattern(
                    /^PGP$/,
                    Joi.string()
                        .trim()
                        .allow('')
                        .regex(/^-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'PGP key format')
                )
                .pattern(
                    /^EMAIL$/,
                    Joi.string()
                        .trim()
                        .email()
                        .label('E-mail Address')
                        .required()
                )
                .max(500)
        });

        const result = Joi.validate(req.body, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        let listData;

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

            if (errors.e) {
                error = 'JavaScript needs to be enabled in order to subscribe';
            }

            if (errors.subscriber || errors.list) {
                return next(err);
            }

            if (!listData) {
                listData = await listModel.get(result.value.list);
            }

            res.render('subscribers/subscribe', {
                page: 'subscribers',
                title: 'Subscription',
                listData,
                list: listData._id,
                fields: listData.fields,
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        listData = await listModel.get(result.value.list);

        if (result.value.tz && !timezones.includes(result.value.tz)) {
            delete result.value.tz;
        }

        result.value.source = 'webform';

        let emailSent;
        try {
            let r = await subscriberModel.create(listData.user, listData._id, result.value);
            emailSent = r.emailSent;
        } catch (err) {
            return showErrors(err);
        }

        res.render('subscribers/subscribed', {
            page: 'subscribers',
            title: 'Subscribed',
            emailSent,
            values: result.value,
            listData,
            list: listData._id
        });
    })
);

router.get(
    '/edit/:subscriber',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            subscriber: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .label('Subscription token')
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

        let subscriberData = await subscriberModel.get(result.value.subscriber);
        if (!subscriberData || subscriberData.status === 'unconfirmed') {
            let error = new Error('Subscription not found');
            error.status = 404;
            throw error;
        }

        let listData = await listModel.get(subscriberData.list);

        res.render('subscribers/edit', {
            page: 'subscribers',
            title: 'Subscription',
            subscriberData,
            subscriber: subscriberData._id,
            listData,
            list: listData._id,
            fields: listData.fields,
            timezones,
            values: subscriberData,
            errors: {},
            error: false
        });
    })
);

router.post(
    '/edit',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            subscriber: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            status: Joi.string()
                .trim()
                .empty('')
                .valid('subscribed', 'unsubscribed')
                .default('subscribed')
                .label('Subscription status'),
            tz: Joi.string()
                .trim()
                .empty('')
                .max(100)
                .label('Timezone'),
            fields: Joi.object()
                .pattern(
                    /^(?:FNAME|LNAME|MERGE\d{3,10})$/,
                    Joi.string()
                        .trim()
                        .allow('')
                        .max(256)
                )
                .pattern(
                    /^PGP$/,
                    Joi.string()
                        .trim()
                        .allow('')
                        .regex(/^-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'PGP key format')
                )
                .pattern(
                    /^EMAIL$/,
                    Joi.string()
                        .trim()
                        .email()
                        .label('E-mail Address')
                        .required()
                )
                .max(500)
        });

        const result = Joi.validate(req.body, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        let subscriberData;
        let listData;

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

            if (errors.subscriber) {
                return next(err);
            }

            if (errors.subscriber || errors.list) {
                return next(err);
            }

            if (!subscriberData) {
                subscriberData = await subscriberModel.get(result.value.subscriber);
            }

            if (!listData) {
                listData = await listModel.get(subscriberData.list);
            }

            if (!subscriberData) {
                let error = new Error('Not found');
                error.status = 404;
                throw error;
            }

            res.render('subscribers/edit', {
                page: 'subscribers',
                title: 'Subscription',
                subscriberData,
                subscriber: subscriberData._id,
                listData,
                list: listData._id,
                fields: listData.fields,
                timezones,
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        subscriberData = await subscriberModel.get(result.value.subscriber);
        if (!subscriberData) {
            let error = new Error('Subscriber not found');
            error.status = 404;
            throw error;
        }

        listData = await listModel.get(subscriberData.list);

        let subscriber = result.value.subscriber;

        let message = 'Preferences updated';

        if (result.value.tz && !timezones.includes(result.value.tz)) {
            delete result.value.tz;
        }

        try {
            let { subscriberData, emailChanged } = await subscriberModel.update(subscriber, result.value, {
                validateEmailChange: true
            });
            if (emailChanged) {
                message += '. Confirmation email sent to ' + subscriberData.tempEmail;
            }
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', message);
        res.redirect('/subscribers/edit/' + subscriberData._id);
    })
);

router.get(
    '/change',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            s: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .label('Subscription token')
                .required(),
            t: Joi.string()
                .hex()
                .lowercase()
                .length(20)
                .label('Confirmation token')
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

        let subscriberData = await subscriberModel.get(result.value.s);

        if (!subscriberData) {
            let error = new Error('Invalid or expired confirmation token, please resubscribe');
            error.status = 404;
            throw error;
        }

        let listData = await listModel.get(subscriberData.list);

        if (subscriberData.tempValid && subscriberData.tempValid < new Date()) {
            await subscriberModel.update(subscriberData._id, {
                tempEmail: null,
                tempValid: null
            });
            req.flash('danger', 'Invalid or expired confirmation token');
            return res.redirect('/subscribers/edit/' + subscriberData._id);
        }

        if (!subscriberData.tempEmail || !subscriberData.confirmToken || subscriberData.confirmToken !== result.value.t) {
            req.flash('danger', 'Invalid or expired confirmation token');
            return res.redirect('/subscribers/edit/' + subscriberData._id);
        }

        await subscriberModel.update(subscriberData._id, {
            email: subscriberData.tempEmail,
            tempEmail: null,
            tempValid: null
        });

        res.render('subscribers/change', {
            page: 'subscribers',
            title: 'Subscription updated',
            subscriber: subscriberData._id,
            subscriberData,
            listData
        });
    })
);

router.get(
    '/unsubscribe/:subscriber',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            subscriber: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .label('Subscription token')
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

        let subscriberData = await subscriberModel.get(result.value.subscriber);
        if (!subscriberData || subscriberData.status === 'unconfirmed') {
            let error = new Error('Subscription not found');
            error.status = 404;
            throw error;
        }

        let listData = await listModel.get(subscriberData.list);

        res.render('subscribers/unsubscribe', {
            page: 'subscribers',
            title: 'Unsubscribe',
            subscriberData,
            subscriber: subscriberData._id,
            listData,
            list: listData._id,
            values: subscriberData,
            errors: {},
            error: false
        });
    })
);

router.post(
    '/unsubscribe',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            subscriber: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            email: Joi.string()
                .trim()
                .empty('')
                .email()
                .label('E-mail Address')
        });

        const result = Joi.validate(req.body, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        let subscriberData, listData;

        let showErrors = async err => {
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

            if (errors.subscriber) {
                return next(err);
            }

            res.render('subscribers/unsubscribe', {
                page: 'subscribers',
                title: 'Unsubscribe',
                subscriberData,
                subscriber: subscriberData._id,
                listData,
                list: listData._id,
                values: result.value,
                errors,
                error
            });
        };

        subscriberData = await subscriberModel.get(result.value.subscriber);
        listData = await listModel.get(subscriberData.list);

        if (!subscriberData) {
            let error = new Error('Subscriber not found');
            error.status = 404;
            throw error;
        }

        if (result.error) {
            return showErrors(result.error);
        }

        let subscriber = result.value.subscriber;

        try {
            await subscriberModel.update(subscriber, {
                status: 'unsubscribed'
            });
        } catch (err) {
            return showErrors(err);
        }

        res.render('subscribers/unsubscribed', {
            page: 'subscribers',
            title: 'Unsubscribed',
            subscriberData,
            subscriber: subscriberData._id,
            listData,
            list: listData._id,
            values: subscriberData,
            errors: {},
            error: false
        });
    })
);

router.get(
    '/subscriptions',
    tools.asyncify(async (req, res) => {
        res.render('subscribers/subscriptions', {
            page: 'subscribers',
            title: 'Subscriptions',
            values: {},
            errors: {},
            error: false
        });
    })
);

router.post(
    '/subscriptions',
    tools.recaptchaVerify,
    tools.asyncify(async (req, res) => {
        const schema = Joi.object().keys({
            email: Joi.string()
                .trim()
                .empty('')
                .email()
                .label('E-mail Address')
                .required(),
            e: Joi.string()
                .trim()
                .valid('')
                .required()
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

            if (errors.e) {
                error = 'JavaScript needs to be enabled in order to subscribe';
            }

            res.render('subscribers/subscriptions', {
                page: 'subscribers',
                title: 'Subscriptions',
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        try {
            await subscriberModel.sendToken(result.value.email);
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'Subscriptions link was sent to your email address');
        res.redirect('/subscribers/subscriptions');
    })
);

router.get(
    '/subscriptions/list',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            t: Joi.string()
                .hex()
                .lowercase()
                .length(20)
                .label('Validation token')
                .required(),
            page: Joi.number()
                .min(0)
                .label('Page')
                .default(1),
            limit: Joi.number()
                .min(0)
                .max(100)
                .label('Limit')
                .default(30)
        });

        const result = Joi.validate(req.query, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        if (result.error) {
            return next(result.error);
        }

        let tokenInfo = await subscriberModel.checkToken(result.value.t);

        let { subscriptions, total, page, pages } = await subscriberModel.listSubscriptions(tokenInfo.email, result.value.page, result.value.limit);

        res.render('subscribers/list', {
            page: 'subscribers',
            title: 'Subscriptions',
            pagingUrl: '/subscribers/subscriptions/list?t=' + encodeURIComponent(result.value.t) + '&limit=' + result.value.limit + '&page=%s',
            email: tokenInfo.email,
            curpage: page,
            pages,
            subscriptions: subscriptions.map((subscriptionData, i) => {
                subscriptionData.nr = (page - 1) * result.value.limit + i + 1;
                return subscriptionData;
            }),
            total
        });
    })
);

module.exports = router;
