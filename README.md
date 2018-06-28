# Minimail Web App

**NB!** Minimail is still a work in progress. It can be used for sending out newsletters but a lot of required functionality is still missing.

Minimail is a mailing list management software, batteries included. Install in on your server and start using it, that's it.

Minimail is simple. It is not targeted for marketing purposes, it is for simpler newsletters. If you want to send an occasional newsletter to your followers then Minimail is for you. If you want to send out triggered campaigns or perform A/B testing, then look somewhere else.

### Requirements

-   Nodejs v8+
-   Redis
-   MongoDB
-   Unblocked port 25 (some hosting providers block or limit usage of port 25)

### Configuration

Make all config changes to config/development.toml (not checked in to git, local only) using the same syntax as in default.toml. You only need to provide the values that you want tot override:

```toml
#default.toml
[www]
host=false
port=3002
proxy=false

#development.toml
[www]
proxy=1 # only sets www.proxy value and keeps everything else as defined in default.toml
```

### Running the app

    $ npm install
    $ npm start

If app was started, then head your browser to http://127.0.0.1:3002/

## Development

### Templates

Templates use pug/jade syntax and are located in [/views](/views). Template files must use \*.pug extension.

### CSS

CSS is bundled with Grunt from scss files, main file being [index.scss](sources/sass/index.scss). Load additional styles from that file. The output is compiled into _/css/styles.css_ (public/css folder is not checked into git, if the folder does not exist then it is created by the grunt task on cimpile time)

### JavaScript

Front end JavaScript is bundled with Webpack using Babel, main file being [index.js](sources/index.js). Load additional scripts from that file.

### Bundling static content

To build js/css bundle run the build script

    npm run build

This bundles all referenced css/js files into a single bundle.js file

### Static files

Document root for static files is in [/public](/public)

## License

EUPL-1.1+
