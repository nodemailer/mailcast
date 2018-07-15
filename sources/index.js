/* eslint no-unused-vars: 0 */
// main application file, loads all required js code which is then bundled into a single file

import $ from 'jquery';
window.$ = window.jQuery = $;

// required code for bootstrap extra features (modals, tabs etc)
import 'bootstrap';
import 'event-source-polyfill';

import './js/mailcast.js';
import './js/actions.js';
import './js/message.js';
