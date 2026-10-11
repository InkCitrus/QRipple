#!/usr/bin/env bash
# Set up (or update) one QRipple access line on Ubuntu 24.04 with nginx.
# Two or more servers on one Tailscale network each serve one line, and all
# of them forward to the same primary QRipple process (with one backup
# process for when the primary is down). Run on each server as root, from a
# directory holding the deploy/ files. On the primary server A of three:
#
#   sudo MAIN_NAME=qr.example.com \
#        ACCESS_LINES=a.qr.example.com,b.qr.example.com,c.qr.example.com \
#        LINE_NAME=a.qr.example.com \
#        LISTEN_HOSTS=127.0.0.1,100.64.0.1 \
#        PRIMARY=127.0.0.1:3000 BACKUP=100.64.0.2:3000 \
#        PEERS=100.64.0.2,100.64.0.3 \
#        bash setup-line.sh [--issue-cert]
#
# (100.64.0.1, .2 and .3 stand for the servers' Tailscale addresses.)
#
# MAIN_NAME:    the page's domain, resolving to every server
# ACCESS_LINES: every line's domain, each resolving to one server
# LINE_NAME:    this server's line
# LISTEN_HOSTS: addresses this server's QRipple listens on (local nginx plus,
#               on the primary and backup servers, the Tailscale address the
#               other servers forward to)
# PRIMARY/BACKUP: the QRipple processes nginx forwards to, as host:port (the
#               backup only while the primary is down). Every server must use
#               the same primary and the same backup: 127.0.0.1:3000 on the
#               server that runs it, its Tailscale address elsewhere.
# PEERS:        the other servers' Tailscale addresses (comma-separated), for
#               ACME challenges that land on the wrong server. PEER, a single
#               address, is still accepted.
#
# Works on Ubuntu 24.04 (x86_64 or arm64), and only adds a "qripple" site to
# nginx, so it can share a server with other sites.
# Idempotent. The HTTPS server block is only enabled once the certificate
# exists; run again with --issue-cert after DNS points at the node.
set -euo pipefail

PEERS="${PEERS:-${PEER:-}}"
: "${MAIN_NAME:?}" "${ACCESS_LINES:?}" "${LINE_NAME:?}" "${LISTEN_HOSTS:?}" "${PRIMARY:?}" "${BACKUP:?}" "${PEERS:?}"
NODE_VERSION="${NODE_VERSION:-v24.21.0}"
BASE=/opt/qripple
SRC="$(cd "$(dirname "$0")" && pwd)"
CERT=/etc/letsencrypt/live/qripple/fullchain.pem

# --- service user and Node.js (official tarball, checksum-verified) ----------
id qripple >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin qripple
mkdir -p "$BASE/app"
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

# --- nginx + certbot; rsync is used by deploy.sh -------------------------------
if ! command -v nginx >/dev/null || ! command -v certbot >/dev/null || ! command -v rsync >/dev/null; then
  # NEEDRESTART_MODE=l: list services using updated libraries, don't restart them.
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y -qq nginx certbot rsync
fi
mkdir -p /var/www/qripple-acme

# --- app settings and service -------------------------------------------------
# Rewrites the settings this script owns and keeps any others added by hand.
mkdir -p /etc/qripple
env_file=/etc/qripple/qripple.env
{
  echo "HOST=$LISTEN_HOSTS"
  echo "ACCESS_LINES=$ACCESS_LINES"
  echo "ALLOWED_ORIGINS=https://$MAIN_NAME"
  echo "TRUST_PROXY=1"
  if [ -f "$env_file" ]; then grep -v -E '^(HOST|ACCESS_LINES|ALLOWED_ORIGINS|TRUST_PROXY)=' "$env_file" || true; fi
} > "$env_file.new"
mv "$env_file.new" "$env_file"
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
peer_servers=""
IFS=',' read -ra peer_list <<< "$PEERS"
for peer in "${peer_list[@]}"; do peer_servers+="    server ${peer// /}:80;\n"; done
sed -e "s|__NAMES__|$MAIN_NAME $LINE_NAME|g" -e "s|__PRIMARY__|$PRIMARY|g" \
    -e "s|__BACKUP__|$BACKUP|g" \
    "$SRC/nginx-qripple.conf.template" |
  awk -v servers="$peer_servers" '$1 == "__PEER_SERVERS__" { printf "%s", servers; next } { print }' > "$site.new"
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
