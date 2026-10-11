#!/usr/bin/env bash
# Ship the current checkout to the servers and restart the service.
#   deploy/deploy.sh [ssh-host ...]      (default: vps-azure vps-tk, the hosted instance)
# Each server must already be set up with setup-server.sh or setup-line.sh, and
# the SSH user must be root or able to sudo without a password. Needs Node.js
# (for the tests) and rsync on this computer.
set -euo pipefail

cd "$(dirname "$0")/.."
HOSTS=("$@")
[ ${#HOSTS[@]} -gt 0 ] || HOSTS=(vps-azure vps-tk)

npm test

for HOST in "${HOSTS[@]}"; do
echo "==> $HOST"

rsync -az --delete \
  --include 'server/***' --include 'public/***' \
  --include 'package.json' --include 'package-lock.json' \
  --exclude '*' \
  ./ "$HOST:/tmp/qripple-release/"

ssh "$HOST" 'sudo bash -s' <<'REMOTE'
set -euo pipefail
APP=/opt/qripple/app
rsync -a --delete --exclude node_modules /tmp/qripple-release/ "$APP/"
cd "$APP"
PATH=/opt/qripple/node/bin:$PATH npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error
chown -R root:root "$APP"
chmod -R a+rX "$APP"
systemctl restart qripple
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
    echo "qripple is up"
    exit 0
  fi
  sleep 1
done
echo "qripple failed to start" >&2
journalctl -u qripple -n 30 --no-pager >&2
exit 1
REMOTE
done
