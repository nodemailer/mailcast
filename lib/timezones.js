'use strict';

const tz = require('./tz.json');

const timezones = [];
Object.keys(tz.zones).forEach(zoneName => {
    timezones.push(zoneName);
});

module.exports.timezones = timezones.sort((a, b) => a.localeCompare(b));
