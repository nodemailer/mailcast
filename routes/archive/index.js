'use strict';

const express = require('express');
const Joi = require('joi');
const tools = require('../../lib/tools');
const router = new express.Router();
const listModel = require('../../models/list');
const subscriberModel = require('../../models/subscriber');
const messageModel = require('../../models/message');

router.use((req, res, next) => {
    req.errorTemplate = 'subscribers/error';
    next();
});

router.get(
    '/:list/view/:message',
    tools.asyncify(async (req, res, next) => {
        const schema = Joi.object().keys({
            list: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .label('List ID')
                .required(),
            message: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .label('Message ID')
                .required(),
            s: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .label('Subscription token')
        });

        req.query.list = req.params.list;
        req.query.message = req.params.message;

        const result = Joi.validate(req.query, schema, {
            abortEarly: false,
            convert: true,
            stripUnknown: true
        });

        if (result.error) {
            return next(result.error);
        }

        let listData = await listModel.get(result.value.list);

        let subscriberData;
        if (result.value.s) {
            subscriberData = await subscriberModel.get(result.value.s);
            if (!subscriberData || subscriberData.status === 'unconfirmed') {
                let error = new Error('Subscription not found');
                error.status = 404;
                throw error;
            }
        }

        let messageData = await messageModel.get(result.value.message);

        if (messageData.list.toString() !== result.value.list) {
            let error = new Error('Message not found');
            error.status = 404;
            throw error;
        }

        res.render('archive/view', {
            page: 'archive',
            title: 'Archived message',
            listData,
            subscriberData,
            messageData
        });
    })
);

module.exports = router;
