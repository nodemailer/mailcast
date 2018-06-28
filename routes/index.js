'use strict';

const express = require('express');
const router = new express.Router();

/* GET home page. */
router.get('/', (req, res) => {
    res.render('index', {
        page: 'home'
    });
});

module.exports = router;
