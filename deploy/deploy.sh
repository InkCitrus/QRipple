#!/usr/bin/env bash
# Ship the current checkout to the server and restart the service.
#   deploy/deploy.sh [ssh-host]      (default: vps-sh)
set -euo pipefail

HOST="${1:-vps-sh}"
cd "$(dirname "$0")/.."

npm test

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
