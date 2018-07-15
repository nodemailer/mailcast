'use strict';

const sass = require('node-sass');

module.exports = function(grunt) {
    // Project configuration.
    grunt.initConfig({
        eslint: {
            all: ['lib/**/*.js', 'routes/**/*.js', 'app.js', 'server.js', 'Gruntfile.js']
        },

        sass: {
            options: {
                implementation: sass,
                sourceMap: true
            },
            dist: {
                files: {
                    'public/css/styles.css': 'sources/sass/index.scss',
                    'public/css/email.css': 'sources/sass/email.scss'
                }
            }
        }
    });

    // Load the plugin(s)
    grunt.loadNpmTasks('grunt-eslint');
    grunt.loadNpmTasks('grunt-sass');

    // Tasks
    grunt.registerTask('default', ['eslint']);
};
