'use strict';

const path = require('path');
//const UglifyJsPlugin = require('uglifyjs-webpack-plugin');

const mode = process.env.NODE_ENV || 'development';

module.exports = {
    mode,

    watch: false,

    devtool: 'source-map',

    entry: './sources/index.js',

    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'public', 'app')
    }
    //,
    //plugins: [new UglifyJsPlugin()]
};
