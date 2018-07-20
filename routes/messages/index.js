'use strict';

const express = require('express');
const moment = require('moment');
const Joi = require('joi');
const log = require('npmlog');
const Handlebars = require('handlebars');
const tools = require('../../lib/tools');
const db = require('../../lib/db');
const messageRenderer = require('../../lib/message-renderer');
const messageModel = require('../../models/message');
const userModel = require('../../models/user');
const listModel = require('../../models/list');
const templateModel = require('../../models/template');
const beautifyHtml = require('js-beautify').html;
const router = new express.Router();
const pubsub = messageModel.getPubSub();

const htmlOptions = {};

const globalFields = [
    {
        key: 'NAME',
        name: 'Full name'
    },
    {
        key: 'SUBJECT',
        name: 'Message subject'
    },
    {
        key: 'PREFERENCES_URL',
        name: 'Preferences URL'
    },
    {
        key: 'UNSUBSCRIBE_URL',
        name: 'Unsubscribe URL'
    },
    {
        key: 'ARCHIVED_URL',
        name: 'Archived URL'
    }
];

router.use(
    tools.asyncify(async (req, res, next) => {
        if (!req.user) {
            req.flash('danger', 'Not logged in');
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

        const result = Joi.validate(req.query, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        if (result.error) {
            return next(result.error);
        }

        let { messages, total, page, pages } = await messageModel.list(req.user._id, result.value.page, result.value.limit);

        moment.locale((req.user.locale || 'en').replace(/_/g, '-'));
        messages = messages.map((messageData, i) => {
            messageData.nr = (page - 1) * result.value.limit + i + 1;
            messageData.createdStr = moment(messageData.created)
                .tz(req.user.tz || 'UTC')
                .format('LLL');
            return messageData;
        });
        moment.locale(false);

        res.render('messages/index', {
            page: 'messages',
            title: 'Messages',
            messagesPage: 'list',
            pagingUrl: '/messages?limit=' + result.value.limit + '&page=%s',
            curpage: page,
            pages,
            messageList: messages, // messages is reserved
            total
        });
    })
);

router.get(
    '/add',
    tools.asyncify(async (req, res) => {
        const schema = Joi.object().keys({
            list: Joi.string()
                .trim()
                .empty('')
                .allow('new')
                .hex()
                .lowercase()
                .length(24)
        });

        const result = Joi.validate(req.query, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        let userData = await userModel.get(req.user._id, { messagesSettings: true });
        let messagesSettings = userData.messagesSettings || {};

        let { lists } = await listModel.list(req.user._id, 1, 1000);

        if (result.error || !result.value.list) {
            return res.render('messages/select-list', {
                page: 'messages',
                title: 'Compose new',
                messagesPage: 'manage',
                lists,
                values: messagesSettings,
                errors: {},
                error: result.error
            });
        }

        if (result.value.list === 'new') {
            return res.redirect('/lists/add');
        }

        messagesSettings.list = result.value.list;

        let listData = await listModel.get(result.value.list, false, { user: req.user._id });
        let { templates } = await templateModel.list(req.user._id, 1, 1000);

        res.render('messages/add', {
            page: 'messages',
            title: 'Compose new',
            messagesPage: 'manage',
            templates,
            listData,
            fields: (listData.fields || []).concat(globalFields),
            editordata: JSON.stringify({
                html: '',
                changes: []
            }),
            values: messagesSettings,
            errors: {},
            error: result.error
        });
    })
);

router.post(
    '/add',
    tools.asyncify(async (req, res) => {
        const schema = Joi.object().keys({
            list: Joi.string()
                .trim()
                .empty('')
                .hex()
                .lowercase()
                .length(24),
            subject: Joi.string()
                .trim()
                .empty('')
                .max(2 * 1024),
            template: Joi.string()
                .trim()
                .empty('')
                .hex()
                .lowercase()
                .length(24)
                .default(false),
            textOnly: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false),
            disableTracking: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false),
            useCodeEditor: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false),
            editordata: Joi.object()
                .keys({
                    html: Joi.string()
                        .trim()
                        .allow('')
                        .max(1024 * 1024)
                        .default(''),
                    changes: Joi.array().default([])
                })
                .default({
                    html: '',
                    changes: []
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

            let listData = await listModel.get(result.value.list, false, { user: req.user._id });
            let { templates } = await templateModel.list(req.user._id, 1, 1000);

            let editordata = typeof result.value.editordata === 'string' ? result.value.editordata : JSON.stringify(result.value.editordata);
            res.render('messages/add', {
                page: 'messages',
                title: 'Compose new',
                messagesPage: 'manage',
                templates,
                listData,
                fields: (listData.fields || []).concat(globalFields),
                editordata,
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        try {
            result.value.editordata.html = beautifyHtml(result.value.editordata.html, htmlOptions);
        } catch (E) {
            //ignore
        }

        try {
            Handlebars.compile(result.value.editordata.html)({});
        } catch (err) {
            err.details = [{ path: 'contents', message: 'Invalid handlebars syntax. ' + err.message }];
            return showErrors(err);
        }

        let message;
        try {
            message = await messageModel.create(req.user._id, result.value);
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'Message draft created');
        res.redirect('/messages/view/' + message);
    })
);

router.get(
    '/edit/:message',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            message: Joi.string()
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

        let messageData = await messageModel.get(result.value.message, false, { user: req.user._id });
        let listData = (await listModel.get(messageData.list, false, { allowEmpty: true })) || {};
        let { templates } = await templateModel.list(req.user._id, 1, 1000);

        res.render('messages/edit', {
            page: 'messages',
            title: 'Edit draft',
            messagePage: 'edit',
            templates,
            listData,
            fields: (listData.fields || []).concat(globalFields),
            editordata: JSON.stringify(messageData.editordata),
            message: result.value.message,
            messageData,
            values: messageData,
            errors: {},
            error: false
        });
    })
);

router.post(
    '/edit',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            message: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            subject: Joi.string()
                .trim()
                .empty('')
                .max(2 * 1024),
            template: Joi.string()
                .trim()
                .empty('')
                .hex()
                .lowercase()
                .length(24)
                .default(false),
            textOnly: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false),
            disableTracking: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false),
            useCodeEditor: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false),
            editordata: Joi.object()
                .keys({
                    html: Joi.string()
                        .trim()
                        .allow('')
                        .max(1024 * 1024)
                        .default(''),
                    changes: Joi.array().default([])
                })
                .default({
                    html: '',
                    changes: []
                })
        });

        const result = Joi.validate(req.body, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        let messageData;

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

            if (errors.message) {
                return next(err);
            }

            if (!messageData) {
                messageData = await messageModel.get(result.value.message, false, { user: req.user._id });
            }

            let listData = await listModel.get(messageData.list, false, { user: req.user._id });
            let { templates } = await templateModel.list(req.user._id, 1, 1000);

            let editordata = typeof result.value.editordata === 'string' ? result.value.editordata : JSON.stringify(result.value.editordata);
            res.render('messages/edit', {
                page: 'messages',
                title: 'Edit draft',
                messagePage: 'edit',
                templates,
                listData,
                fields: (listData.fields || []).concat(globalFields),
                editordata,
                messageData,
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        try {
            result.value.editordata.html = beautifyHtml(result.value.editordata.html, htmlOptions);
        } catch (E) {
            //ignore
        }

        try {
            Handlebars.compile(result.value.editordata.html)({});
        } catch (err) {
            err.details = [{ path: 'contents', message: 'Invalid handlebars syntax. ' + err.message }];
            return showErrors(err);
        }

        messageData = await messageModel.get(result.value.message, false, { user: req.user._id });

        try {
            await messageModel.update(messageData._id, result.value);
        } catch (err) {
            return showErrors(err);
        }

        req.flash('success', 'Message draft updated');
        res.redirect('/messages/edit/' + result.value.message);
    })
);

router.post(
    '/delete',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            message: Joi.string()
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
        await messageModel.get(result.value.message, false, { user: req.user._id });

        let success = await messageModel.delete(result.value.message);

        if (success) {
            req.flash('success', 'Message deleted');
        }

        res.redirect('/messages');
    })
);

router.post(
    '/send',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            message: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            test: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false)
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
        let messageData = await messageModel.get(result.value.message, false, { user: req.user._id });

        if (!messageData.draft) {
            req.flash('danger', 'Message is not a draft');
            return res.redirect('/messages/view/' + result.value.message);
        }

        let userData = await userModel.get(req.user._id, { emailValidated: true });
        if (!userData.emailValidated) {
            req.flash('danger', 'Your email address is not yet validated');
            return res.redirect('/messages/view/' + result.value.message);
        }

        if (result.value.test) {
            await messageRenderer.processMessage(false, messageData, true);
            req.flash('success', 'Test messages scheduled for sending');
        } else {
            let success = await messageModel.update(result.value.message, {
                lastProcessedId: null,
                status: 'queueing',
                locked: 0,
                draft: false
            });
            // notify queue processor that there's a new message queued for sending
            await db.redis.publish('queue', JSON.stringify({ message: messageData._id.toString(), action: 'new' }));

            if (success) {
                req.flash('success', 'Message scheduled for sending');
            }
        }

        res.redirect('/messages/view/' + result.value.message);
    })
);

router.post(
    '/reset',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            message: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            test: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false)
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
        let messageData = await messageModel.get(result.value.message, false, { user: req.user._id });

        if (messageData.draft) {
            req.flash('danger', 'Message is a draft');
            return res.redirect('/messages/view/' + result.value.message);
        }

        let success = await messageModel.update(result.value.message, {
            lastProcessedId: null,
            status: 'draft',
            locked: 0,
            draft: true,
            counters: {}
        });

        // notify queue processor about the reset
        await db.redis.publish('queue', JSON.stringify({ message: messageData._id.toString(), action: 'reset' }));

        if (success) {
            req.flash('success', 'Message status was reset');
        }

        res.redirect('/messages/view/' + result.value.message);
    })
);

router.get(
    '/settings',
    tools.asyncify(async (req, res) => {
        let userData = await userModel.get(req.user._id, { messagesSettings: true });
        let messagesSettings = userData.messagesSettings || {};
        res.render('messages/settings', {
            page: 'messages',
            title: 'Settings',
            messagesPage: 'settings',
            values: messagesSettings,
            errors: {},
            error: false
        });
    })
);

router.post(
    '/settings',
    tools.asyncify(async (req, res) => {
        const schema = Joi.object().keys({
            textOnly: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false),
            disableTracking: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false),
            useCodeEditor: Joi.boolean()
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

            res.render('messages/settings', {
                page: 'messages',
                title: 'Settings',
                messagesPage: 'settings',
                values: result.value,
                errors,
                error
            });
        };

        if (result.error) {
            return showErrors(result.error);
        }

        await userModel.update(req.user._id, {
            messagesSettings: result.value
        });

        req.flash('success', 'Settings updated');
        res.redirect('/messages/settings');
    })
);

router.get(
    '/view/:message',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            message: Joi.string()
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

        let messageData = await messageModel.get(result.value.message, false, { user: req.user._id });
        let listData = (await listModel.get(messageData.list, false, { allowEmpty: true })) || {};

        let status = false;
        let progress = false;
        if (!messageData.draft) {
            let counters = messageData.counters || {};
            status = {
                queued: counters.queued || 0,
                delivered: counters.delivered || 0,
                rejected: counters.rejected || 0,
                bounced: counters.bounced || 0,
                blacklisted: counters.bounced || 0
            };

            status.progress = status.queued > 0 ? Math.min(1, (status.delivered + status.rejected + status.blacklisted) / status.queued) : 0;
            progress = (status.progress ? Math.round(status.progress * 100) : 0) + '%';
        }

        res.render('messages/message/view', {
            page: 'messages',
            title: messageData.subject,
            messagePage: 'view',
            listData,
            message: result.value.message,
            status,
            progress,
            messageData
        });
    })
);

router.get(
    '/stream/:message',
    tools.asyncify(async (req, res) => {
        const schema = Joi.object().keys({
            message: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            'Last-Event-ID': Joi.string()
                .hex()
                .lowercase()
                .length(24)
        });

        if (req.header('Last-Event-ID')) {
            req.params['Last-Event-ID'] = req.header('Last-Event-ID');
        }

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        let stopped = false;
        let idleTimer = false;
        let idleCounter = 0;

        res.writeHead(200, { 'Content-Type': 'text/event-stream' });

        let sendError = err => {
            try {
                res.end('event: error\ndata: ' + err.message.split('\n').join('\ndata: ') + '\n\n');
            } catch (E) {
                // ignore
            }
        };

        let sendIdleComment = () => {
            clearTimeout(idleTimer);
            if (stopped) {
                return;
            }
            try {
                res.write(': idling ' + ++idleCounter + '\n\n');
            } catch (err) {
                // ignore
            }
            idleTimer = setTimeout(sendIdleComment, 15 * 1000);
        };

        let resetIdleComment = () => {
            clearTimeout(idleTimer);
            if (stopped) {
                return;
            }
            idleTimer = setTimeout(sendIdleComment, 15 * 1000);
        };

        if (result.error) {
            return sendError(result.error);
        }

        //let lastEventId = result.value['Last-Event-ID'] ? new ObjectID(result.value['Last-Event-ID']) : false;
        let messageData = await messageModel.get(result.value.message, false, { user: req.user._id });
        //let listData = (await listModel.get(messageData.list, false, { allowEmpty: true })) || {};

        let subscriber = await pubsub.subscribe(messageData._id, async data => {
            clearTimeout(idleTimer);
            if (stopped) {
                await subscriber.close();
                return;
            }

            let response = [];
            response.push(
                'data: ' +
                    JSON.stringify(data, false, 2)
                        .split('\n')
                        .join('\ndata: ')
            );

            try {
                res.write(response.join('\n') + '\n\n');
            } catch (err) {
                // ignore
                log.error('Stream', err);
            }

            resetIdleComment();
        });

        let stop = err => {
            clearTimeout(idleTimer);
            subscriber.close().catch(err => log.error('Stream', err));
            if (err) {
                log.error('Stream', 'message=%s error=%s', result.value.message, err.message);
                stopped = true;
                return sendError(err);
            }
            if (stopped) {
                return;
            }
            stopped = true;
            try {
                res.end();
            } catch (err) {
                log.error('Stream', 'message=%s error=%s', result.value.message, err.message);
            }
        };

        res.once('end', stop);
        req.once('end', stop);

        res.once('close', stop);
        req.once('close', stop);

        res.once('finish', stop);
        req.once('finish', stop);

        res.once('error', stop);
        req.once('error', stop);

        sendIdleComment();
    })
);

module.exports = router;
