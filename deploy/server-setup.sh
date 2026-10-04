#!/usr/bin/env bash
#
# Prepare a fresh Ubuntu server (24.04) for DrivenX. Run once, as root.
#
#   curl -fsSL <raw url of this file> -o server-setup.sh && bash server-setup.sh
#
# NOT YET RUN ON A REAL SERVER. Everything else in deploy/ was rehearsed end to end on a
# development machine; this script needs a server to be proven on. Read it before running
# it, and run it on a fresh machine rather than one already in use.
#
# Safe to run twice: every step checks before it changes anything.

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

echo "==> timezone: Asia/Dubai"
# Cron reads the server's clock. On UTC, the 07:00 alert run would happen at 11:00 Dubai.
timedatectl set-timezone Asia/Dubai

echo "==> packages and automatic security updates"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git ufw fail2ban unattended-upgrades rsync openssl
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> firewall: SSH, HTTP and HTTPS only"
# Docker publishes ports around ufw. That is harmless here only because nothing but Caddy
# publishes a port - the database and document store are reachable from inside Docker alone.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> the drivenx user and its directories"
id drivenx >/dev/null 2>&1 || useradd --create-home --shell /bin/bash drivenx
usermod -aG docker drivenx
install -d -o drivenx -g drivenx -m 755 /opt/drivenx
install -d -o drivenx -g drivenx -m 755 /var/log/drivenx
install -d -o drivenx -g drivenx -m 700 /var/backups/drivenx
install -d -o drivenx -g drivenx -m 700 /etc/drivenx

echo "==> backup passphrase"
if [[ ! -s /etc/drivenx/backup.pass ]]; then
  openssl rand -hex 32 > /etc/drivenx/backup.pass
  chown drivenx:drivenx /etc/drivenx/backup.pass
  chmod 600 /etc/drivenx/backup.pass
  echo "    Generated /etc/drivenx/backup.pass."
  echo "    COPY IT SOMEWHERE OFF THIS SERVER NOW. Without it the backups cannot be decrypted,"
  echo "    and if the server is lost the passphrase is lost with it."
fi

cat <<'NEXT'

Done. Next, as the drivenx user (su - drivenx):

  git clone <repository> /opt/drivenx
  cd /opt/drivenx
  cp deploy/env.production.example .env     # then fill in every line
  deploy/deploy.sh --first-run
  crontab deploy/crontab

NEXT
