#!/bin/bash

# NB! This install script works in Ubuntu 16+

# Usage
#  sudo ./install.sh [APPDOMAIN]
#  sudo ./install.sh mailer.example.com

if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root" 1>&2
   exit 1
fi

set -e

HOSTNAME=`hostname`
APPDOMAIN=$1
APPDOMAIN="${APPDOMAIN:-$HOSTNAME}"

export DEBIAN_FRONTEND=noninteractive

# install requirements of the installer
apt-get update
apt-get -q -y install software-properties-common lsb-release wget python pwgen

APP_ROOT="/opt/mailcast"
MONGODB="3.6"
CODENAME=`lsb_release -c -s`
NODEREPO="node_10.x"

# Load or generate passwords for databases
if [ -f "$HOME/mailcast.passwords" ]; then
    echo "Found password file"
    source "$HOME/mailcast.passwords"
else
    echo "Password file not found, generating new passwords"

    MONGO_ADMIN_USER="admin"
    MONGO_ADMIN_PASSWORD=`pwgen 18 -1`
    MONGO_APP_USER="mailcast"
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
REDIS_PASSWORD=\"$REDIS_PASSWORD\"" > "$HOME/mailcast.passwords"

    chmod 0400 "$HOME/mailcast.passwords"
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

    sleep 3 # just in case

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
        user: '$MONGO_APP_USER',
        pwd: '$MONGO_APP_PASSWORD',
        roles: [
            { role: 'readWrite', db: 'mailcast' }
        ]
    });"

fi

useradd mailcast 2>/dev/null || true
mkdir -p /home/mailcast
chown mailcast:mailcast /home/mailcast

# Remove existing service (if exists)
systemctl stop mailcast 2>/dev/null || true
systemctl disable mailcast 2>/dev/null || true
rm -rf /etc/systemd/system/mailcast.service

mkdir -p "$APP_ROOT"
cd "$APP_ROOT"
git clone git@github.com:nodemailer/mailcast.git .

# application config
rm -rf /etc/mailcast
cp -r "$APP_ROOT/config" /etc/mailcast
mv /etc/mailcast/default.toml /etc/mailcast/mailcast.toml

# service files
cp "$APP_ROOT/setup/etc/logrotate.d/mailcast" /etc/logrotate.d/mailcast
cp "$APP_ROOT/setup/etc/rsyslog.d/25-mailcast.conf" /etc/rsyslog.d/25-mailcast.conf
cp "$APP_ROOT/setup/etc/systemd/system/mailcast.service" /etc/systemd/system/mailcast.service
cp "$APP_ROOT/setup/etc/tmpfiles.d/mailcast.conf" /etc/tmpfiles.d/mailcast.conf

sed -i -e "s#APP_ROOT#$APP_ROOT#g;s#NODE_PATH#`which node`#g;" /etc/systemd/system/mailcast.service
sed -i -e "s/secret cat/`pwgen 18 -1`/g;s/port=3002/port=80/g;s;#baseUrl=false;baseUrl=\"http://$APPDOMAIN\";g" /etc/mailcast/mailcast.toml

# configure database options
echo "redis=\"redis://127.0.0.1:6379/1?password=$REDIS_PASSWORD\"
mongo=\"mongodb://$MONGO_APP_USER:$MONGO_APP_PASSWORD@127.0.0.1:27017/mailcast?authSource=admin\"
sender=\"minimta\"" > /etc/mailcast/dbs.toml

echo "user=\"mailcast\"
group=\"www-data\"" > /etc/mailcast/user.toml

# Application folder permissions
chown -R mailcast:mailcast "$APP_ROOT"

# config folder permissions
chown -R mailcast:mailcast /etc/mailcast
chmod -R 0750 /etc/mailcast

# Prepare log directory
mkdir -p /var/log/mailcast
chown -R syslog:adm /var/log/mailcast
chmod 0750 /var/log/mailcast

# Install dependencies and build static assets
sudo -H -u mailcast npm install

# reload log options
systemctl restart rsyslog 2>/dev/null || true

# Start Mailcast
systemctl enable mailcast
systemctl start mailcast

echo "All done. Database passwords were stored to $HOME/mailcast.passwords"
echo "Open http://$APPDOMAIN/ in your browser to use Mailcast"
