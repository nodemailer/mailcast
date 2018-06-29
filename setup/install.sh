#!/bin/bash

# NB! This install script works in Ubuntu 16+

if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 1>&2
   exit 1
fi

set -e

export DEBIAN_FRONTEND=noninteractive

# install requirements of the installer
apt-get update
apt-get -q -y install software-properties-common lsb-release wget python pwgen

APP_ROOT="/opt/minimail"
MONGODB="3.6"
CODENAME=`lsb_release -c -s`
NODEREPO="node_10.x"

# Load or generate passwords for databases
if [ -f "$HOME/minimail.passwords" ]; then
    echo "Found password file"
    source "$HOME/minimail.passwords"
else
    echo "Password file not found, generating new passwords"

    MONGO_ADMIN_USER="admin"
    MONGO_ADMIN_PASSWORD=`pwgen 18 -1`
    MONGO_APP_USER="minimail"
    MONGO_APP_PASSWORD=`pwgen 18 -1`
    REDIS_PASSWORD=`pwgen 18 -1`

    echo "#!/bin/bash
# MongoDB Admin User
MONGO_ADMIN_USER=\"$MONGO_ADMIN_USER\"
MONGO_ADMIN_PASSWORD=\"$MONGO_ADMIN_PASSWORD\"

# MongoDB Application User
MONGO_APP_USER=\"$MONGO_APP_USER\"
MONGO_APP_PASSWORD=\"$MONGO_APP_PASSWORD\"

# Redis password
REDIS_PASSWORD=\"$REDIS_PASSWORD\"
" > "$HOME/minimail.passwords"

    chmod 0400 "$HOME/minimail.passwords"
fi

# start gathering packages to be installed
INSTALL_LIST="build-essential dnsutils"

# Nodejs
if ! [ -x "$(command -v node)" ]; then
    wget -qO- https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add -
    echo "deb https://deb.nodesource.com/$NODEREPO $CODENAME main" > /etc/apt/sources.list.d/nodesource.list
    echo "deb-src https://deb.nodesource.com/$NODEREPO $CODENAME main" >> /etc/apt/sources.list.d/nodesource.list
    INSTALL_LIST="$INSTALL_LIST nodejs"
fi

# Redis
if ! [ -x "$(command -v redis-cli)" ]; then
    apt-add-repository -y ppa:chris-lea/redis-server
    INSTALL_LIST="$INSTALL_LIST redis-server"
fi

# MongoDB
if ! [ -x "$(command -v mongo)" ]; then
    wget -qO- https://www.mongodb.org/static/pgp/server-${MONGODB}.asc | sudo apt-key add
    # hardcode xenial as at this time there are no non-dev packages for bionic (http://repo.mongodb.org/apt/ubuntu/dists/)
    echo "deb [ arch=amd64,arm64 ] http://repo.mongodb.org/apt/ubuntu xenial/mongodb-org/$MONGODB multiverse" > /etc/apt/sources.list.d/mongodb-org.list
    INSTALL_LIST="$INSTALL_LIST mongodb-org"
fi

# install required packages
apt-get update
apt-get -q -y install $INSTALL_LIST

if [[ $INSTALL_LIST = *"redis-server"* ]]; then
    # make sure redis-server is enabled
    systemctl enable redis-server

    # enable authentication
    echo "requirepass $REDIS_PASSWORD" >> /etc/redis/redis.conf

    # restart server
    systemctl restart redis-server
fi

if [[ $INSTALL_LIST = *"mongodb-org"* ]]; then
    # make sure mongo is enabled and started
    systemctl enable mongod
    systemctl start mongod

    # Create admin user
    mongo admin --eval "db.createUser({
        user: '$MONGO_ADMIN_USER',
        pwd: '$MONGO_ADMIN_PASSWORD',
        roles: [
            { role: 'userAdminAnyDatabase', db: 'admin' },
            { role: 'readWriteAnyDatabase', db: 'admin' }
        ]
    });"

    # Create application user
    mongo admin -u "$MONGO_ADMIN_USER" -p "$MONGO_ADMIN_PASSWORD" --eval "db.createUser({
        user: '$MONGO_MAIL_USER',
        pwd: '$MONGO_MAIL_PASSWORD',
        roles: [
            { role: 'readWrite', db: 'minimail' }
        ]
    });"

fi

# TODO: set up code and services

# Remove existing service (if exists)
systemctl stop minimail 2>/dev/null || true
systemctl disable minimail 2>/dev/null || true
rm -rf /etc/systemd/system/minimail.service

mkdir -p "$APP_ROOT"
cd "$APP_ROOT"
git clone git://github.com/nodemailer/minimail.git .

# application config
cp -r "$APP_ROOT/config" /etc/minimail
mv /etc/minimail/default.toml /etc/minimail/minimail.toml

# service files
cp "$APP_ROOT/etc/logrotate.d/minimail" /etc/logrotate.d/minimail
cp "$APP_ROOT/etc/rsyslog.d/25-minimail.conf" /etc/rsyslog.d/25-minimail.conf
cp "$APP_ROOT/etc/systemd/system/minimail.service" /etc/systemd/system/minimail.service
cp "$APP_ROOT/etc/tmpfiles.d/minimail.conf" /etc/tmpfiles.d/minimail.conf

sed -i -e "s#APP_ROOT#$APP_ROOT#g;" /etc/systemd/system/minimail.service

# Prepare log directory
mkdir -p /var/log/minimail
chown -R syslog:adm /var/log/minimail
chmod 0750 /var/log/minimail

# Install dependencies and build static assets
npm install

# configure database options
echo "redis=\"redis://127.0.0.1:6379/1?password=$REDIS_PASSWORD\"
mongo=\"mongodb://$MONGO_APP_USER:$MONGO_APP_PASSWORD@127.0.0.1:27017/minimail?authSource=admin\"
sender=\"minimta\"" > /etc/minimail/dbs.toml

# Start Minimail
systemctl enable minimail
systemctl start minimail

echo "All done. See generated passwords in $HOME/minimail.passwords"
