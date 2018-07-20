'use strict';

const Joi = require('joi');
const express = require('express');
const tools = require('../../../lib/tools');
const subscriberModel = require('../../../models/subscriber');
const router = new express.Router();

router.get(
    '/add',
    tools.asyncify(async (req, res) => {
        let listData = req.listData;
        res.render('lists/subscribers/add', {
            page: 'lists',
            listPage: 'manage',
            title: 'Add new subscriber',
            listData,
            values: {
                fields: {}
            },
            fields: listData.fields.map(field => {
                field.showHidden = field.hidden;
                field.hidden = false;
                return field;
            }),
            errors: {},
            error: false
        });
    })
);

router.post(
    '/add',
    tools.asyncify(async (req, res) => {
        const schema = Joi.object().keys({
            note: Joi.string()
                .trim()
                .empty('')
                .max(65 * 1024)
                .label('Note'),
            testSubscriber: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false),
            status: Joi.string()
                .trim()
                .empty('')
                .valid('subscribed', 'unsubscribed', 'unconfirmed', 'bounced')
                .default('subscribed')
                .label('Subscription status'),
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

        let showErrors = err => {
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

            let listData = req.listData;
            res.render('lists/subscribers/add', {
                page: 'lists',
                listPage: 'manage',
                title: 'Add new subscriber',
                values: result.value,
                listData,
                fields: listData.fields.map(field => {
                    field.showHidden = field.hidden;
                    field.hidden = false;
                    return field;
                }),
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        result.value.source = 'admin';
        if (req.user.tz) {
            result.value.tz = req.user.tz;
        }

        let subscriber;
        try {
            let r = await subscriberModel.create(req.user._id, req.listData._id, result.value, { updateExisting: true });
            subscriber = r.subscriber;
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'Subscribed ' + result.value.email + ' to ' + req.listData.name);
        res.redirect('/lists/view/' + req.listData._id + '?subscriber=' + subscriber);
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

        if (!subscriberData) {
            let error = new Error('Subscriber not found');
            error.status = 404;
            throw error;
        }

        if (subscriberData.user.toString() !== req.user._id.toString()) {
            let error = new Error('No permissions to access this subscriber');
            error.status = 403;
            throw error;
        }

        if (!subscriberData.fields) {
            subscriberData.fields = {};
        }

        let listData = req.listData;
        res.render('lists/subscribers/edit', {
            page: 'lists',
            listPage: 'manage',
            title: 'Edit subscriber',
            subscriber: subscriberData._id,
            values: subscriberData,
            listData,
            fields: listData.fields.map(field => {
                field.showHidden = field.hidden;
                field.hidden = false;
                return field;
            }),
            errors: {},
            error: false
        });
    })
);

router.post(
    '/delete',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            subscriber: Joi.string()
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

        let success = await subscriberModel.delete(result.value.subscriber);

        if (success) {
            req.flash('success', 'Subscriber deleted');
        }

        res.redirect('/lists/view/' + req.listData._id);
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
            note: Joi.string()
                .trim()
                .empty('')
                .max(65 * 1024)
                .label('Note'),
            testSubscriber: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false),
            status: Joi.string()
                .trim()
                .empty('')
                .valid('subscribed', 'unsubscribed', 'unconfirmed', 'bounced')
                .default('subscribed')
                .label('Subscription status'),
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

        let showErrors = err => {
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

            let listData = req.listData;
            res.render('lists/subscribers/edit', {
                page: 'lists',
                listPage: 'manage',
                title: 'Edit subscriber',
                subscriber: result.value.subscriber,
                email: subscriberData.email,
                values: result.value,
                listData,
                fields: listData.fields.map(field => {
                    field.showHidden = field.hidden;
                    field.hidden = false;
                    return field;
                }),
                errors,
                error
            });
        };

        subscriberData = await subscriberModel.get(result.value.subscriber);

        if (!subscriberData) {
            let error = new Error('Subscriber not found');
            error.status = 404;
            throw error;
        }

        if (subscriberData.user.toString() !== req.user._id.toString()) {
            let error = new Error('No permissions to access this subscriber');
            error.status = 403;
            throw error;
        }

        if (result.error) {
            return showErrors(result.error);
        }

        let subscriber = result.value.subscriber;
        try {
            await subscriberModel.update(subscriber, result.value);
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'Subscriber updated');
        res.redirect('/lists/subscribers/' + req.listData._id + '/edit/' + subscriber);
    })
);

module.exports = router;
