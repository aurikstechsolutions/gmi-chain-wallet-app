#!/bin/bash
##############################################################
# MChain VPS Setup Script — Ubuntu 22.04
# Run as root: bash setup.sh
##############################################################
set -e

echo "==> Updating system..."
apt-get update && apt-get upgrade -y

echo "==> Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "==> Installing pnpm..."
npm install -g pnpm pm2

echo "==> Installing PostgreSQL 15..."
apt-get install -y postgresql-15 postgresql-contrib

echo "==> Installing PgBouncer..."
apt-get install -y pgbouncer

echo "==> Installing Redis..."
apt-get install -y redis-server
# Tune Redis for 24 GB server — allow up to 2 GB
sed -i 's/# maxmemory <bytes>/maxmemory 2gb/' /etc/redis/redis.conf
sed -i 's/# maxmemory-policy noeviction/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf
systemctl restart redis-server
systemctl enable redis-server

echo "==> Installing Nginx..."
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Installing Certbot (SSL)..."
# Run this manually after DNS is pointed at the server:
# certbot --nginx -d yourdomain.com

echo "==> Creating log directory..."
mkdir -p /var/log/mchain
mkdir -p /var/www/admin-panel
mkdir -p /var/www/mchain

echo "==> Applying PostgreSQL tuning..."
cat deploy/postgresql.conf >> /etc/postgresql/15/main/postgresql.conf
systemctl restart postgresql

echo "==> Configuring PgBouncer..."
cp deploy/pgbouncer.ini /etc/pgbouncer/pgbouncer.ini
# You still need to set up /etc/pgbouncer/userlist.txt with your DB credentials
# Format: "username" "md5hash_of_password"
systemctl restart pgbouncer
systemctl enable pgbouncer

echo "==> Configuring Nginx..."
cp deploy/nginx.conf /etc/nginx/nginx.conf
# Edit nginx.conf: replace 'yourdomain.com' with your actual domain
nginx -t && systemctl reload nginx

echo ""
echo "===================================================="
echo "  Setup complete! Next steps:"
echo "  1. Edit deploy/nginx.conf — replace yourdomain.com"
echo "  2. Run: certbot --nginx -d yourdomain.com"
echo "  3. Create .env file in /var/www/mchain with secrets"
echo "  4. Build: pnpm build"
echo "  5. Start: pm2 start deploy/ecosystem.config.cjs --env production"
echo "  6. pm2 save && pm2 startup"
echo "===================================================="
