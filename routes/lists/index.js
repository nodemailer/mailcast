'use strict';

const express = require('express');
const Joi = require('joi');
const tools = require('../../lib/tools');
const listModel = require('../../models/list');
const subscriberModel = require('../../models/subscriber');
const beautifyHtml = require('js-beautify').html;
const moment = require('moment-timezone');
const router = new express.Router();

const statuses = {
    subscribed: 'Subscribed',
    unsubscribed: 'Unsubscribed',
    unconfirmed: 'Unconfirmed',
    bounced: 'Bounced'
};

const htmlOptions = {};

router.use(
    tools.asyncify(async (req, res, next) => {
        if (!req.user) {
            req.flash('danger', 'Not logged in');
            return res.redirect('/account/login');
        }
        next();
    })
);

router.use(
    '/subscribers/:list',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            list: Joi.string()
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

        req.listData = await listModel.get(result.value.list, false, { user: req.user._id });
        res.locals.list = req.listData._id;

        next();
    }),
    require('./subscribers')
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

        let { lists, total, page, pages } = await listModel.list(req.user._id, result.value.page, result.value.limit);

        res.render('lists/index', {
            page: 'lists',
            title: 'Lists',
            listPage: 'list',
            pagingUrl: '/lists?limit=' + result.value.limit + '&page=%s',
            curpage: page,
            pages,
            lists: lists.map((listData, i) => {
                listData.nr = (page - 1) * result.value.limit + i + 1;
                return listData;
            }),
            total
        });
    })
);

router.get(
    '/add',
    tools.asyncify(async (req, res) => {
        res.render('lists/add', {
            page: 'lists',
            title: 'Add new list',
            listPage: 'manage',
            values: {
                email: req.user.email,
                fromname: req.user.name
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
                .label('List name')
                .required(),
            description: Joi.string()
                .trim()
                .empty('')
                .max(512)
                .label('List description'),
            email: Joi.string()
                .trim()
                .email()
                .label('E-mail Address')
                .required(),
            fields: Joi.string()
                .trim()
                .empty('')
                .max(1024)
                .label('Custom fields'),
            fromname: Joi.string()
                .trim()
                .max(256)
                .label('Sender name')
                .required(),
            header: Joi.string()
                .trim()
                .allow('')
                .max(64 * 1024)
                .label('Header HTML'),
            pgp: Joi.boolean()
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

            res.render('lists/add', {
                page: 'lists',
                title: 'Add new list',
                listPage: 'manage',
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        if (result.value.header) {
            result.value.header = beautifyHtml(result.value.header, htmlOptions);
        }

        let list;
        try {
            list = await listModel.create(req.user._id, result.value);
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'List created');
        res.redirect('/lists/view/' + list);
    })
);

router.post(
    '/delete',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            list: Joi.string()
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

        // throws if missing or not permitted
        await listModel.get(result.value.list, false, { user: req.user._id });

        let success = await listModel.delete(result.value.list);

        if (success) {
            req.flash('success', 'List deleted');
        }

        res.redirect('/lists');
    })
);

router.get(
    '/view/:list',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            list: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
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

        let listData = await listModel.get(result.value.list, false, { user: req.user._id });

        let { subscribers, total, page, pages } = await subscriberModel.list(listData._id, result.value.page, result.value.limit, result.value.query);

        let url = new URL('lists/view/' + result.value.list, res.locals.appurl);
        url.searchParams.append('paging', 'true'); // make sure we have at least one query argument

        if (result.value.limit) {
            url.searchParams.append('limit', result.value.limit);
        }

        if (result.value.query) {
            url.searchParams.append('query', result.value.query);
        }

        moment.locale((req.user.locale || 'en').replace(/_/g, '-'));
        subscribers = subscribers.map((subscriberData, i) => {
            subscriberData.nr = (page - 1) * result.value.limit + i + 1;
            subscriberData.statusStr = statuses[subscriberData.status] || subscriberData.status;
            subscriberData.createdStr = moment(subscriberData.created)
                .tz(req.user.tz || 'UTC')
                .format('LLL');
            return subscriberData;
        });
        moment.locale(false);

        res.render('lists/view', {
            page: 'lists',
            title: 'List',
            listPage: 'view',
            list: result.value.list,
            query: result.value.query || '',
            pagingUrl: url.pathname + url.search + '&page=%s',
            curpage: page,
            pages,
            subscribers,
            total,
            listData,
            error: false
        });
    })
);

router.get(
    '/edit/:list',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            list: Joi.string()
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

        let listData = await listModel.get(result.value.list, false, { user: req.user._id });

        res.render('lists/edit', {
            page: 'lists',
            listPage: 'edit',
            title: 'Edit list',
            list: listData._id,
            values: listData,
            listData,
            errors: {},
            error: false
        });
    })
);

router.post(
    '/edit',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            list: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            name: Joi.string()
                .trim()
                .max(256)
                .label('List name')
                .required(),
            description: Joi.string()
                .trim()
                .empty('')
                .max(512)
                .label('List description'),
            email: Joi.string()
                .trim()
                .email()
                .label('E-mail Address')
                .required(),
            fromname: Joi.string()
                .trim()
                .max(256)
                .label('Sender name')
                .required(),
            header: Joi.string()
                .trim()
                .allow('')
                .max(64 * 1024)
                .label('Header HTML'),
            pgp: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false)
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
                    if (!errors[detail.path]) {
                        errors[detail.path] = detail.message;
                    }
                });
            } else {
                error = err.message;
            }

            if (errors.list) {
                return next(err);
            }

            if (!listData) {
                listData = await listModel.get(result.value.list, false, { user: req.user._id });
            }

            res.render('lists/edit', {
                page: 'lists',
                listPage: 'edit',
                title: 'Edit list',
                list: result.value.list,
                listData,
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        listData = await listModel.get(result.value.list, false, { user: req.user._id });

        if (result.value.header) {
            result.value.header = beautifyHtml(result.value.header, htmlOptions);
        }

        let list = result.value.list;
        try {
            await listModel.update(list, result.value);
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'List updated');
        res.redirect('/lists/edit/' + list);
    })
);

router.get(
    '/fields/:list',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            list: Joi.string()
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

        let listData = await listModel.get(result.value.list, false, { user: req.user._id });

        res.render('lists/fields', {
            page: 'lists',
            listPage: 'fields',
            title: 'Form fields',
            list: listData._id,
            listData,
            fields: listData.fields.map((field, i) => {
                field.nr = i + 1;
                return field;
            }),
            values: {},
            errors: {},
            error: false
        });
    })
);

router.post(
    '/fields',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            list: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            ordering: Joi.string()
                .trim()
                .empty('')
                .max(1024),
            name: Joi.object().pattern(
                /^PGP|MERGE\d{3,10}$/,
                Joi.string()
                    .trim()
                    .empty('')
                    .max(1024)
            ),
            del: Joi.object().pattern(
                /^PGP|MERGE\d{3,10}$/,
                Joi.boolean()
                    .truthy(['Y', 'true', 'yes', 'on', 1])
                    .falsy(['N', 'false', 'no', 'off', 0, ''])
            ),
            hidden: Joi.object()
                .pattern(
                    /^(?:FNAME|LNAME|PGP|MERGE\d{3,10})$/,
                    Joi.boolean()
                        .truthy(['Y', 'true', 'yes', 'on', 1])
                        .falsy(['N', 'false', 'no', 'off', 0, ''])
                )
                .default({}),
            fields: Joi.string()
                .trim()
                .empty('')
                .max(1024)
                .label('Custom fields')
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
                    if (!errors[detail.path]) {
                        errors[detail.path] = detail.message;
                    }
                });
            } else {
                error = err.message;
            }

            if (errors.list) {
                return next(err);
            }

            if (!listData) {
                listData = await listModel.get(result.value.list, false, { user: req.user._id });
            }

            res.render('lists/fields', {
                page: 'lists',
                listPage: 'fields',
                title: 'Form fields',
                list: listData._id,
                listData,
                fields: listData.fields.map((field, i) => {
                    field.nr = i + 1;
                    return field;
                }),
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        listData = await listModel.get(result.value.list, false, { user: req.user._id });

        let list = result.value.list;
        try {
            await listModel.updateFields(listData, result.value);
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'Fields updated');
        res.redirect('/lists/fields/' + list);
    })
);

module.exports = router;
