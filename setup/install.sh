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
apt-get -q -y install software-properties-common lsb-release wget python

MONGODB="3.6"
CODENAME=`lsb_release -c -s`
NODEREPO="node_10.x"

INSTALL_LIST="build-essential dnsutils pwgen"

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

apt-get update
apt-get -q -y install $INSTALL_LIST

# make sure mongo is enabled and started
systemctl enable mongod
systemctl start mongod

# TODO: set up code and services
