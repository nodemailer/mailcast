'use strict';

const config = require('wild-config');
const punycode = require('punycode');
const openpgp = require('openpgp');
const addressparser = require('nodemailer/lib/addressparser');
const libmime = require('libmime');
const util = require('util');
const log = require('npmlog');
const crypto = require('crypto');
const fingerprint = require('key-fingerprint').fingerprint;
const forge = require('node-forge');

module.exports.asyncify = middleware => async (req, res, next) => {
    try {
        await middleware(req, res, next);
    } catch (err) {
        next(err);
    }
};

module.exports.asyncifyCb = fn => async (...args) => {
    let cb;
    if (args.length && typeof args[args.length - 1]) {
        cb = args.pop();
    } else {
        cb = err => {
            if (err) {
                log.error('ASYNC', err);
            }
        };
    }

    try {
        return cb(await fn(...args));
    } catch (err) {
        return cb(err);
    }
};

module.exports.asyncImmediate = async fn =>
    new Promise((resolve, reject) => {
        setImmediate(() => {
            try {
                fn();
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    });

module.exports.asyncTimeout = async (fn, delay) =>
    new Promise((resolve, reject) => {
        setTimeout(() => {
            try {
                fn();
                resolve();
            } catch (err) {
                reject(err);
            }
        }, delay);
    });

module.exports.normalizeEmail = email =>
    (email || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/@(.*)$/, (m, domain) => {
            try {
                if (/^xn--/.test(domain)) {
                    domain = punycode
                        .toUnicode(domain)
                        .normalize('NFC')
                        .toLowerCase()
                        .trim();
                }
            } catch (E) {
                // ignore
            }
            return '@' + domain;
        });

module.exports.checkPubKey = async pubKey => {
    if (!pubKey) {
        return false;
    }

    // try to encrypt something with that key
    let armored = openpgp.key.readArmored(pubKey).keys;

    if (!armored || !armored[0]) {
        throw new Error('Did not find key information');
    }

    let fingerprint = armored[0].primaryKey.fingerprint;
    if (fingerprint) {
        fingerprint = Array.from(fingerprint)
            .map(c => (c < 0x10 ? '0' : '') + c.toString(16).toUpperCase())
            .join(':');
    }
    let name, address;
    if (armored && armored[0] && armored[0].users && armored[0].users[0] && armored[0].users[0].userId) {
        let user = addressparser(armored[0].users[0].userId.userid);
        if (user && user[0] && user[0].address) {
            address = module.exports.normalizeEmail(user[0].address);
            try {
                name = libmime.decodeWords(user[0].name || '').trim();
            } catch (E) {
                // failed to parse value
                name = user[0].name || '';
            }
        }
    }

    let ciphertext = await openpgp.encrypt({
        data: 'Hello, World!',
        publicKeys: armored
    });

    if (/^-----BEGIN PGP MESSAGE/.test(ciphertext.data)) {
        // everything checks out
        return {
            address,
            name,
            fingerprint,
            key: pubKey
        };
    }

    throw new Error('Unexpected message');
};

module.exports.generateDkim = async () => {
    let keypair = await util.promisify(forge.rsa.generateKeyPair)({ bits: 2048, workers: -1 });

    let privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);
    let publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
    let fp = fingerprint(privateKeyPem, 'sha256', true);
    let selector = [
        (config.title || '').replace(/[^a-z0-9]/g, ''),
        new Date()
            .toString()
            .substr(4, 3)
            .toLowerCase() +
            new Date()
                .getFullYear()
                .toString()
                .substr(-2),
        crypto.randomBytes(2).toString('hex')
    ]
        .filter(v => v)
        .join('-');

    return {
        privateKey: privateKeyPem,
        publicKey: publicKeyPem,
        fp,
        selector
    };
};
