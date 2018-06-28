'use strict';

const express = require('express');
const Joi = require('joi');
const tools = require('../../lib/tools');
const templateModel = require('../../models/template');
const router = new express.Router();
const moment = require('moment-timezone');
const beautifyHtml = require('js-beautify').html;
const Handlebars = require('handlebars');

const htmlOptions = {};

router.use(
    tools.asyncify(async (req, res, next) => {
        if (!req.user) {
            req.flash('danger', 'You need to be logged in to access restricted pages');
            return res.redirect('/account/login');
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
                .default(30)
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

        let { templates, total, page, pages } = await templateModel.list(req.user._id, result.value.page, result.value.limit, result.value.query);

        let url = new URL('templates', res.locals.appurl);
        url.searchParams.append('paging', 'true'); // make sure we have at least one query argument

        if (result.value.limit) {
            url.searchParams.append('limit', result.value.limit);
        }

        moment.locale((req.user.locale || 'en').replace(/_/g, '-'));
        templates = templates.map((templateData, i) => {
            templateData.nr = (page - 1) * result.value.limit + i + 1;
            templateData.createdStr = moment(templateData.created)
                .tz(req.user.tz || 'UTC')
                .format('LLL');
            return templateData;
        });
        moment.locale(false);

        res.render('templates/index', {
            page: 'templates',
            title: 'Templates',
            templatePage: 'list',
            pagingUrl: url.pathname + url.search + '&page=%s',
            curpage: page,
            pages,
            templates,
            total,
            error: false
        });
    })
);

router.get(
    '/add',
    tools.asyncify(async (req, res) => {
        res.render('templates/add', {
            page: 'templates',
            title: 'Add new templates',
            templatePage: 'manage',
            values: {
                code: templateModel.defaultTemplate
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
                .label('Name')
                .required(),
            code: Joi.string()
                .trim()
                .empty('')
                .max(256 * 1024)
                .label('Base template')
                .default(templateModel.defaultTemplate)
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

            res.render('templates/add', {
                page: 'templates',
                title: 'Add new templates',
                templatePage: 'manage',
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        try {
            Handlebars.compile(result.value.code)({});
        } catch (err) {
            err.details = [{ path: 'code', message: 'Invalid handlebars syntax. ' + err.message }];
            return showErrors(err);
        }

        if (result.value.code) {
            result.value.code = beautifyHtml(result.value.code, htmlOptions);
        }

        let template;
        try {
            template = await templateModel.create(req.user._id, result.value);
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'Template created');
        res.redirect('/templates?template=' + template);
    })
);

router.get(
    '/edit/:template',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            template: Joi.string()
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

        let templateData = await templateModel.get(result.value.template, false, { user: req.user._id });

        if (!templateData) {
            let error = new Error('Template not found');
            error.status = 404;
            throw error;
        }

        res.render('templates/edit', {
            page: 'templates',
            title: 'Edit template',
            templatePage: 'manage',
            values: templateData,
            template: templateData._id,
            errors: {},
            error: false
        });
    })
);

router.post(
    '/edit',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            template: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            name: Joi.string()
                .trim()
                .max(256)
                .label('Name')
                .required(),
            code: Joi.string()
                .trim()
                .empty('')
                .max(256 * 1024)
                .label('Base template')
                .default(templateModel.defaultTemplate)
                .required()
        });

        const result = Joi.validate(req.body, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        let templateData;

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

            if (errors.template) {
                return next(err);
            }

            if (!templateData) {
                templateData = await templateModel.get(result.value.template, false, { user: req.user._id });
            }

            if (!templateData) {
                let error = new Error('Template not found');
                error.status = 404;
                throw error;
            }

            res.render('templates/edit', {
                page: 'templates',
                title: 'Edit template',
                templatePage: 'manage',
                template: templateData._id,
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        try {
            Handlebars.compile(result.value.code)({});
        } catch (err) {
            err.details = [{ path: 'code', message: 'Invalid handlebars syntax. ' + err.message }];
            return showErrors(err);
        }

        templateData = await templateModel.get(result.value.template, false, { user: req.user._id });

        if (!templateData) {
            let error = new Error('Template not found');
            error.status = 404;
            throw error;
        }

        if (result.value.code) {
            result.value.code = beautifyHtml(result.value.code, htmlOptions);
        }

        try {
            await templateModel.update(result.value.template, result.value);
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'Template data updated');
        res.redirect('/templates/edit/' + result.value.template);
    })
);

router.post(
    '/delete',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            template: Joi.string()
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

        let templateData = await templateModel.get(result.value.template, false, { user: req.user._id });

        if (!templateData) {
            let error = new Error('Template not found');
            error.status = 404;
            throw error;
        }

        let success = await templateModel.delete(result.value.template);

        if (success) {
            req.flash('success', 'Template deleted');
        }

        res.redirect('/templates');
    })
);

module.exports = router;
