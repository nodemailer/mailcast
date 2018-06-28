'use strict';

let userModel = require('../models/user');
const gravatarUrl = require('gravatar-url');

module.exports.loadUserData = async (req, res, next) => {
    if (!req.session.uid) {
        req.user = res.locals.user = false;
        return next();
    }

    let userData = await userModel.get(req.session.uid, {
        _id: true,
        name: true,
        email: true,
        status: true,
        emailValidated: true,
        locale: true,
        tz: true
    });

    if (!userData) {
        req.user = res.locals.user = false;
        return next();
    }

    userData.gravatar = gravatarUrl(userData.email, {
        size: 20,
        // 404, mm, identicon, monsterid, wavatar, retro, blank
        default: 'identicon'
    });

    req.user = res.locals.user = userData;
    next();
};
