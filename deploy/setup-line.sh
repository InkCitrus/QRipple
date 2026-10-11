#!/usr/bin/env bash
# Set up (or update) one QRipple access line on Ubuntu 24.04 with nginx.
# Run on the server as root, from a directory holding the deploy/ files:
#
#   sudo LINE_NAME=az.qripple.inkorange.com \
#        LISTEN_HOSTS=127.0.0.1,100.64.0.1 \
#        PRIMARY=127.0.0.1:3000 BACKUP=100.64.0.2:3000 PEER=100.64.0.2 \
#        bash setup-line.sh [--issue-cert]
#
# LISTEN_HOSTS: addresses this node's QRipple listens on (local nginx plus its
#               Tailscale address, so the other node can reach it)
# PRIMARY/BACKUP: QRipple processes nginx forwards to (backup used when the
#               primary is down); every line must use the same primary
# PEER:         the other node's Tailscale address, for ACME challenges that
#               land on the wrong node
#
# Idempotent. The HTTPS server block is only enabled once the certificate
# exists; run again with --issue-cert after DNS points at the node.
set -euo pipefail

: "${LINE_NAME:?}" "${LISTEN_HOSTS:?}" "${PRIMARY:?}" "${BACKUP:?}" "${PEER:?}"
MAIN_NAME="${MAIN_NAME:-qripple.inkorange.com}"
ACCESS_LINES="${ACCESS_LINES:-tk.qripple.inkorange.com,az.qripple.inkorange.com}"
NODE_VERSION="${NODE_VERSION:-v24.21.0}"
BASE=/opt/qripple
SRC="$(cd "$(dirname "$0")" && pwd)"
CERT=/etc/letsencrypt/live/qripple/fullchain.pem

# --- service user and Node.js (official tarball, checksum-verified) ----------
id qripple >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin qripple
mkdir -p "$BASE/app"
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

# --- nginx + certbot ----------------------------------------------------------
if ! command -v nginx >/dev/null || ! command -v certbot >/dev/null; then
  # NEEDRESTART_MODE=l: list services using updated libraries, don't restart them.
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y -qq nginx certbot
fi
mkdir -p /var/www/qripple-acme

# --- app settings and service -------------------------------------------------
mkdir -p /etc/qripple
cat > /etc/qripple/qripple.env <<EOF
HOST=$LISTEN_HOSTS
ACCESS_LINES=$ACCESS_LINES
ALLOWED_ORIGINS=https://$MAIN_NAME
TRUST_PROXY=1
EOF
install -m 0644 "$SRC/qripple.service" /etc/systemd/system/qripple.service
systemctl daemon-reload
systemctl enable qripple >/dev/null

# --- certificate (main name + this line) ---------------------------------------
if [ "${1:-}" = "--issue-cert" ] && [ ! -f "$CERT" ]; then
  certbot certonly --webroot -w /var/www/qripple-acme --cert-name qripple \
    -d "$MAIN_NAME" -d "$LINE_NAME" \
    --deploy-hook "systemctl reload nginx" \
    --non-interactive --agree-tos --register-unsafely-without-email
fi

# --- nginx site ------------------------------------------------------------------
site=/etc/nginx/sites-available/qripple
sed -e "s|__NAMES__|$MAIN_NAME $LINE_NAME|g" -e "s|__PRIMARY__|$PRIMARY|g" \
    -e "s|__BACKUP__|$BACKUP|g" -e "s|__PEER__|$PEER|g" \
    "$SRC/nginx-qripple.conf.template" > "$site.new"
if [ ! -f "$CERT" ]; then
  # No certificate yet: HTTP only (ACME challenges + redirect).
  sed -i '/#__HTTPS_BEGIN__/,/#__HTTPS_END__/d' "$site.new"
fi
prev=""
if [ -f "$site" ]; then prev="$(mktemp)"; cp "$site" "$prev"; fi
mv "$site.new" "$site"
ln -sfn "$site" /etc/nginx/sites-enabled/qripple
if ! nginx -t; then
  # Never leave a broken file behind: other sites on this nginx would stop reloading.
  echo "nginx config test failed; rolling back" >&2
  if [ -n "$prev" ]; then mv "$prev" "$site"; else rm -f /etc/nginx/sites-enabled/qripple "$site"; fi
  exit 1
fi
[ -n "$prev" ] && rm -f "$prev"
systemctl reload nginx

# --- firewall (only if ufw is in use) ---------------------------------------------
if ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

echo "line $LINE_NAME ready ($( [ -f "$CERT" ] && echo HTTPS || echo 'HTTP only, no certificate yet' ))"
