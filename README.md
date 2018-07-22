# Mailcast

**NB!** Mailcast is still a work in progress. It can be used for sending out newsletters but a lot of required functionality is still missing.

Mailcast is a mailing list management software, batteries included. Install in on your server and start using it, that's it.

Mailcast is for simpler newsletters sent from your own infrastructure. If you want to send an occasional newsletter to your followers then Mailcast is for you. If you want to send out triggered campaigns or perform A/B testing and use a delivery service like SES, then look somewhere else ([Mailtrain](http://mailtrain.org/) might be a good fit).

Sending emails from your own servers might seem daunting at first, so Mailcast tries to make everything as easy to manage as possible. Mailcast is able to send through multiple local IP addresses, it can detect IP blacklisting and sign all messages with DKIM as it uses [ZoneMTA](https://github.com/zone-eu/zone-mta/) as the underlying MTA component.

### Features

-   List management
-   Customizable subscription forms
-   Multi tenant, let your family or friends manage their own lists
-   Built-in MTA, no need to use a separate SMTP service

### Requirements

-   Nodejs v8+
-   Redis
-   MongoDB
-   Unblocked port 25 (some hosting providers block or limit usage of port 25 to prevent spam)

### Fast install

Mailtrain can be configured to run on Ubuntu 16.04/18.04 using the included [install script](setup/install.sh). Run it as root in an emtpy VPS (empty meaning that you do not have anything using SMTP or HTTP ports).

Installation sets up config folder to `/etc/mailcast` and a systemd service called `mailcast`.

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

**EUPL-1.1+** (1.1 or later)
