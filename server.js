'use strict';

/**
 * Module dependencies.
 */

const config = require('wild-config');
const fork = require('child_process').fork;

if (process.env.NODE_CONFIG_ONLY === 'true') {
    console.log(require('util').inspect(config, false, 22)); // eslint-disable-line
    return process.exit();
}

const log = require('npmlog');
const cluster = require('cluster');
const db = require('./lib/db');

log.level = config.log.level;

async function main() {
    // Initialize database connection
    await db.connect().catch(err => {
        log.error(process.pid + '/Db', 'Failed to setup database connection. ' + err.message);
        process.exit(2);
    });

    log.info(process.pid + '/Db', 'Database connection established');

    if (cluster.isMaster) {
        if (config.title) {
            process.title = config.title + ': master';
        }

        await require('./lib/initialize')();

        let workers = new Set();

        let forkChild = () => {
            let worker = cluster.fork();
            workers.add(worker);
            log.info(process.pid + '/App', `Forked worker ${worker.process.pid}`);
        };

        let createWorkerProcess = name => {
            let worker = fork(__dirname + '/services/' + name + '.js', process.argv.slice(1), {
                cwd: process.cwd(),
                env: process.env,
                silent: false
            });

            workers.add(worker);
            log.info(process.pid + '/App', `Forked ${name} worker ${worker.pid}`);

            worker.on('exit', (code, signal) => {
                log.info(process.pid + '/App', `${name} worker ${worker.pid} died with %s:%s`, code, signal);
                workers.delete(worker);
                setTimeout(() => createWorkerProcess(name), 1000);
            });
        };

        log.info(process.pid + '/App', `Master ${process.pid} is running`);

        cluster.on('exit', (worker, code, signal) => {
            log.info(process.pid + '/App', `WWW worker ${worker.process.pid} died with %s%s`, code, signal ? ':' + signal : '');
            workers.delete(worker);
            setTimeout(forkChild, Math.random() * 3000 + 2500);
        });

        config.on('reload', () => {
            workers.forEach(child => {
                try {
                    child.kill('SIGHUP');
                } catch (E) {
                    //ignore
                }
            });
        });

        // Fork workers.
        for (let i = 0; i < config.processes; i++) {
            forkChild();
        }

        setTimeout(() => {
            ['minimta', 'bouncer', 'renderer'].forEach(key => {
                createWorkerProcess(key);
            });
        }, 1000);
    } else {
        const http = require('http');

        const port = config.www.port;
        const host = config.www.host;

        if (config.title) {
            process.title = config.title + ': worker';
        }

        const app = require('./app'); // eslint-disable-line global-require
        app.set('port', port);

        /**
         * Create HTTP server.
         */

        const server = http.createServer(app);

        server.on('error', err => {
            if (!['listen', 'bind'].includes(err.syscall)) {
                throw err;
            }

            let bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;

            // handle specific listen errors with friendly messages
            switch (err.code) {
                case 'EACCES':
                    log.error(process.pid + '/Express', '%s requires elevated privileges', bind);
                    return process.exit(1);
                case 'EADDRINUSE':
                    log.error(process.pid + '/Express', '%s is already in use', bind);
                    return process.exit(1);
                default:
                    throw err;
            }
        });

        server.on('listening', () => {
            let addr = server.address();
            let bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr.port;

            if (config.process.group) {
                process.setgid(config.process.group);
            }

            if (config.process.user) {
                process.setuid(config.process.user);
            }

            log.info(process.pid + '/Express', 'WWW server listening on %s', bind);
        });

        server.listen(port, host);
    }

    process.on('unhandledRejection', err => {
        log.error(process.pid + '/App', 'Unhandled rejection: %s' + ((err && err.stack) || err));
    });
}

main().catch(err => {
    log.error('App', err);
    process.exit(1);
});
