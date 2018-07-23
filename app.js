'use strict';

const config = require('wild-config');
const log = require('npmlog');
const util = require('util');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const favicon = require('serve-favicon');
const logger = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);
const flash = require('connect-flash');
const csurf = require('csurf');
const db = require('./lib/db');
const auth = require('./lib/auth');
const tools = require('./lib/tools');
const MessageFormat = require('messageformat');
const settingsModel = require('./models/settings');
const Recaptcha = require('express-recaptcha').Recaptcha;

const app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// Handle proxies. Needed to resolve client IP
if (config.www.proxy) {
    app.set('trust proxy', config.www.proxy);
}

// Do not expose software used
app.disable('x-powered-by');

app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));

logger.token('site-user', req => (req.session && req.session.uid) || '-');

app.use(cookieParser());

app.use(
    session({
        name: 'mailcast',
        store: new RedisStore({
            client: db.redis.duplicate()
        }),
        secret: config.www.secret,
        saveUninitialized: false,
        resave: false,
        cookie: {
            secure: false //!!config.www.secure
        }
    })
);

app.use(
    logger(config.log.www, {
        stream: {
            write: message => {
                message = (message || '').toString();
                if (message) {
                    log.http(process.pid + '/Express', message.replace('\n', '').trim());
                }
            }
        }
    })
);

app.use(express.static(path.join(__dirname, 'public')));

app.use(flash());

app.use((req, res, next) => {
    // make sure flash messages are available
    res.locals.flash = req.flash.bind(req);
    next();
});

app.use(
    bodyParser.urlencoded({
        extended: true,
        limit: config.www.postsize
    })
);

app.use(
    bodyParser.json({
        limit: config.www.postsize
    })
);

app.use(tools.asyncify(auth.loadUserData));

app.use(
    csurf({
        cookie: true
    })
);

// handle CSRF tokens
app.use(
    tools.asyncify(async (req, res, next) => {
        res.locals.csrf = req.csrfToken();

        res.locals.locale = req.user && req.user.locale;

        let locale = ((req.user && req.user.locale) || 'en').replace('_', '-');

        let mf;
        try {
            mf = new MessageFormat(locale);
        } catch (E) {
            mf = new MessageFormat('en');
        }

        let currencyFmt = mf.compile('{N, number, currency}');
        let numberFmt = mf.compile('{N, number}');

        res.locals.currency = (cents, currency) => {
            mf.currency = currency;
            return currencyFmt({ N: cents / 100 });
        };
        res.locals.num = num => numberFmt({ N: Number(num) || 0 });
        res.locals.msg = (format, args) => mf.compile(format)(args);

        let settings = {};
        try {
            settings = await settingsModel.get('global_*');
        } catch (err) {
            // fallback to defaults
        }

        let baseUrl = settings.global_site_baseUrl;
        if (!baseUrl) {
            let proto = req.protocol;
            let hostname = req.hostname;
            let protoPort = proto === 'https' ? 443 : 80;
            let baseUrl = config.www.baseUrl;
            if (!baseUrl) {
                baseUrl =
                    proto +
                    '://' +
                    hostname +
                    ((!config.www.proxy || !req.headers['x-forwarder-for']) && config.www.port !== protoPort ? ':' + config.www.port : '');
            }

            // set default site URL
            await settingsModel.set('global_site_baseUrl', baseUrl);
        }

        res.locals.appname = settings.global_site_appName;
        res.locals.appurl = settings.global_site_baseUrl;
        res.locals.disableJoin = settings.global_user_disableJoin;

        res.locals.format = util.format;

        if (settings.global_site_recaptchaEnabled) {
            res.locals.recaptcha = settings.global_site_recaptchaSiteKey;
            req.recaptchaHandler = new Recaptcha(settings.global_site_recaptchaSiteKey, settings.global_site_recaptchaSecretKey);
        }

        if (req.user) {
            // prevent caching logged in pages
            res.set('cache-control', 'no-cache, must-revalidate, max-age=0');
            res.set('expires', 'Wed, 11 Jan 1984 05:00:00 GMT');
        }

        next();
    })
);

app.use('/', require('./routes'));
app.use('/account', require('./routes/account'));
app.use('/lists', require('./routes/lists'));
app.use('/subscribers', require('./routes/subscribers'));
app.use('/users', require('./routes/users'));
app.use('/messages', require('./routes/messages'));
app.use('/templates', require('./routes/templates'));
app.use('/archive', require('./routes/archive'));

// catch 404 and forward to error handler
app.use((req, res, next) => {
    let err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use((err, req, res, next) => {
        if (!err) {
            return next();
        }
        res.status(err.status || 500);
        res.render(req.errorTemplate || 'error', {
            status: err.status || 500,
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use((err, req, res, next) => {
    if (!err) {
        return next();
    }
    res.status(err.status || 500);
    res.render(req.errorTemplate || 'error', {
        status: err.status || 500,
        message: err.message
    });
});

module.exports = app;
