'use strict';

const path = require('path');

let configLocation = false;
process.argv = process.argv.map(arg => {
    if (arg.indexOf('--config=') === 0) {
        arg = arg.replace(/\/[^/"']+(["'])?$/, '/mta/minimta.toml$1');
        configLocation = arg;
    }
    return arg;
});

if (!configLocation) {
    process.argv.push('--config=' + path.join(__dirname, '..', 'config', 'mta', 'minimta.toml'));
}

// start the app
require('zone-mta');
