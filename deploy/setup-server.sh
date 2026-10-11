#!/usr/bin/env bash
# One-time setup of a single QRipple server on Ubuntu 24.04 (x86_64 or arm64),
# with Caddy for HTTPS. Point the domain at the server first, then run as root
# from a directory holding the deploy/ files:
#   sudo DOMAIN=qr.example.com bash setup-server.sh
# Installs Node.js (official tarball, checksum-verified) under /opt/qripple,
# Caddy from the Ubuntu archive, a locked-down systemd service, and ufw rules
# (if ufw is installed). Then deploy the app with deploy/deploy.sh.
set -euo pipefail

: "${DOMAIN:?set DOMAIN to the domain name of the site, e.g. DOMAIN=qr.example.com}"
NODE_VERSION="${NODE_VERSION:-v24.21.0}"
BASE=/opt/qripple
SRC="$(cd "$(dirname "$0")" && pwd)"

# --- service user -----------------------------------------------------------
id qripple >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin qripple
mkdir -p "$BASE/app"

# --- Node.js ----------------------------------------------------------------
case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64 | arm64) NODE_ARCH=arm64 ;;
  *) echo "unsupported CPU architecture: $(uname -m)" >&2; exit 1 ;;
esac
if [ ! -x "$BASE/node-$NODE_VERSION/bin/node" ]; then
  tmp="$(mktemp -d)"
  tarball="node-$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
  curl -fsSL -o "$tmp/$tarball" "https://nodejs.org/dist/$NODE_VERSION/$tarball"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -)
  mkdir -p "$BASE/node-$NODE_VERSION"
  tar -xJf "$tmp/$tarball" -C "$BASE/node-$NODE_VERSION" --strip-components=1
  rm -rf "$tmp"
fi
ln -sfn "$BASE/node-$NODE_VERSION" "$BASE/node"

# --- Caddy (TLS + reverse proxy); rsync is used by deploy.sh ----------------
if ! command -v caddy >/dev/null || ! command -v rsync >/dev/null; then
  # NEEDRESTART_MODE=l: only list services using updated libraries instead of
  # restarting them (it otherwise restarts unrelated services on this host).
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y -qq caddy rsync
fi
sed "s|__DOMAIN__|$DOMAIN|g" "$SRC/Caddyfile" > /etc/caddy/Caddyfile
chmod 0644 /etc/caddy/Caddyfile

# --- systemd ----------------------------------------------------------------
install -m 0644 "$SRC/qripple.service" /etc/systemd/system/qripple.service
systemctl daemon-reload
systemctl enable qripple caddy
# Caddy starts fetching the certificate now; the app follows with deploy.sh.
systemctl restart caddy

# --- firewall ---------------------------------------------------------------
if command -v ufw >/dev/null; then
  ufw allow 80/tcp comment 'QRipple ACME + HTTP redirect'
  ufw allow 443/tcp comment 'QRipple HTTPS'
  ufw allow 443/udp comment 'QRipple HTTP/3'
fi

echo "Setup done. Now deploy the app from your computer: deploy/deploy.sh <ssh-host>"
