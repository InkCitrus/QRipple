#!/usr/bin/env bash
# One-time server setup for Ubuntu 24.04. Run on the server as root:
#   sudo NODE_VERSION=v24.21.0 bash setup-server.sh
# Installs Node.js (official tarball, checksum-verified) under /opt/qripple,
# Caddy from the Ubuntu archive, a locked-down systemd service, and ufw rules.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v24.21.0}"
BASE=/opt/qripple
SRC="$(cd "$(dirname "$0")" && pwd)"

# --- service user -----------------------------------------------------------
id qripple >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin qripple
mkdir -p "$BASE/app"

# --- Node.js ----------------------------------------------------------------
if [ ! -x "$BASE/node-$NODE_VERSION/bin/node" ]; then
  tmp="$(mktemp -d)"
  tarball="node-$NODE_VERSION-linux-x64.tar.xz"
  curl -fsSL -o "$tmp/$tarball" "https://nodejs.org/dist/$NODE_VERSION/$tarball"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  (cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum -c -)
  mkdir -p "$BASE/node-$NODE_VERSION"
  tar -xJf "$tmp/$tarball" -C "$BASE/node-$NODE_VERSION" --strip-components=1
  rm -rf "$tmp"
fi
ln -sfn "$BASE/node-$NODE_VERSION" "$BASE/node"

# --- Caddy (TLS + reverse proxy) --------------------------------------------
if ! command -v caddy >/dev/null; then
  # NEEDRESTART_MODE=l: only list services using updated libraries instead of
  # restarting them (it otherwise restarts unrelated services on this host).
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y caddy
fi
install -m 0644 "$SRC/Caddyfile" /etc/caddy/Caddyfile

# --- systemd ----------------------------------------------------------------
install -m 0644 "$SRC/qripple.service" /etc/systemd/system/qripple.service
systemctl daemon-reload
systemctl enable qripple caddy

# --- firewall ---------------------------------------------------------------
ufw allow 80/tcp comment 'QRipple ACME + HTTP redirect'
ufw allow 443/tcp comment 'QRipple HTTPS'
ufw allow 443/udp comment 'QRipple HTTP/3'

echo "Setup done. Deploy the app with deploy/deploy.sh, then: systemctl reload caddy"
