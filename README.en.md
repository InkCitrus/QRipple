# QRipple

[简体中文](README.md) | English

**Real-time QR Code Sharing** · *Scan once. Share everywhere.*

Try it: <https://qripple.inkorange.com>

QRipple is a website for sharing a QR code live, with no install and no sign-up. The sharer points their phone's camera at a QR code; receivers enter a 5-digit pairing code and see the same QR code on their own screens. When the code's content changes, every receiver updates at once.

**Only the decoded data is sent; camera images never leave the sharer's device.** The server keeps no records, and a session is gone as soon as it ends.

## How to use it

1. **Sharer**: open the site, tap *Start Sharing*, allow camera access and point the camera at the QR code. The page shows a 5-digit pairing code; *Copy invite* or *Share invite* sends receivers a link like `https://qripple.inkorange.com/24914` instead.
2. **Receiver**: open the invite link, or open the site, tap *Join Session* and enter the pairing code, to see the same QR code (regenerated on the device, ready to scan). Receivers can copy the content or pass a link in it to another app through the system share sheet.
3. The session ends, and its code stops working, when the sharer taps *End sharing* or stays offline for more than 2 minutes.

## Features

- **On-device decoding**: ZXing (WebAssembly) in a Web Worker in the sharer's browser, up to about 16 frames per second. Blurry frames get a sharpened second try; browsers without WebAssembly fall back to jsQR.
- **Changing QR codes**: new content is pushed to every receiver after it is read twice. If old and new content briefly appear at the same spot, the later content is followed and superseded values are hidden to avoid switching back and forth.
- **Several QR codes**: separate codes are numbered on the preview for the sharer to pick, and the chosen code is followed from then on. Codes first seen together still require a choice because their refresh order is unknown. Small codes next to a large one are found too.
- **Auto zoom**: a code the camera can see but not read is zoomed in on automatically (where the camera supports zoom). Zoom decreases when a code fills the scan crop. If zoom still leaves unreadable codes after 3 seconds, it returns to the base level and waits 2 seconds to refocus before retrying.
- **Receivers**: the QR code is regenerated from the raw bytes as SVG; web links in the content can be clicked; the content can be copied, or a link passed to another app through the system share sheet, or, on Apple devices, handed to a Shortcuts shortcut instead (see below). The screen stays on during a session.
- **Recovery**: a sharer who reloads the page returns to the same session; receivers reconnect automatically.
- **Multiple access lines**: one server can be reached through several network routes, and clients use whichever connects first (see Deployment).
- **Chinese and English**: chosen from the browser language, switchable at the top right.

## Browser requirements

- Browsers only allow the camera on HTTPS pages (or `localhost`), so sharers must use HTTPS.
- Sharers need a modern browser with camera access; on phones, Safari, Chrome or Edge is recommended. Some phone makers' own browsers and in-app browsers (such as WeChat's) may not allow the camera or the system share sheet.
- Receivers can use any modern browser.

## Passing links to apps

- **Android, iPhone, iPad and Mac**: tap *Share link* on the content card and pick the app in the system share sheet. This needs a browser with system sharing (such as Safari or a recent Chrome or Edge). If an app doesn't appear in the sheet, it doesn't accept shared links.
- A web page can't preselect or remember the share target, so you pick the app each time (some Android versions let you pin frequently used apps to the front of the sheet).
- **iPhone, iPad and Mac**: in the settings at the top right, turn on *Use a shortcut* and enter the shortcut's name. *Share link* on the content card then becomes *Run shortcut*, which passes the whole QR content to that shortcut as input. The setting only appears on Apple devices.

## How it works

```
Sharer's browser                        Server (Node.js)                   Receiver's browser
camera → Web Worker (ZXing) decode ──► temporary in-memory session ──WebSocket──► qrcode-generator
          (images stay on device)        keeps only the latest data                 re-encodes as SVG
```

- **Sharer**: camera frames (1080p) are cropped to the viewfinder and decoded in a Web Worker ([zxing-wasm](https://github.com/Sec-ant/zxing-wasm), with [jsQR](https://github.com/cozmo/jsQR) as a fallback). The first code is sent as soon as it is read; unchanged content is not sent again; when nothing can be read, the last result stays and scanning never stops.
- **Server**: a single Node.js process whose only runtime dependency is `ws`. Sessions live entirely in memory: nothing is written to disk and content is never logged.
- **Receiver**: the raw bytes (sent as base64) are re-encoded with [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), using the more compact numeric or alphanumeric modes where possible. The code may look different from the original, but it carries the same data.

See [docs/PROTOCOL.md](docs/PROTOCOL.md) for the full message reference.

## Session rules

| Rule | Default | Environment variable |
| --- | --- | --- |
| Pairing code | 5 digits, 10000–99999; not reused for 10 minutes after a session ends | `CODE_COOLDOWN_MS` |
| Sharer offline | the session ends after 2 minutes offline (page closed, network lost, phone locked too long) | `HOST_GRACE_MS` |
| Session safety cap | 24 hours (not shown in the UI; stops a page left open from keeping a session forever) | `SESSION_TTL_MS` |
| Receivers per session | 50 | `MAX_RECEIVERS` |
| Maximum data size | 8 KiB (enough for any valid QR code) | `MAX_DATA_BYTES` |

The sharer's session token is kept in sessionStorage, so reloading the page resumes the session. Reconnecting receivers are matched by session ID, so they never land in a new session that reused the same code.

## Security and privacy

- Camera images are only processed on the sharer's device. The server only receives decoded data, keeps just the latest item per session, and deletes it when the session ends.
- Only a connection holding the sharer token (a 192-bit random value issued when the session is created) can update or end a session.
- Per-IP limits: wrong pairing codes are throttled after 10 attempts (one more every 30 seconds), and session creation and concurrent connections are limited. Messages are rate-limited per connection; oversized messages close the connection.
- WebSocket connections are checked against the page's Origin. Pages are served with a strict CSP, `Permissions-Policy`, `X-Frame-Options` and other security headers.
- QR content is treated as untrusted: only http(s) URLs become links, and content is never inserted as HTML.
- **The 5-digit pairing code is not strong authentication.** Wrong guesses are throttled, but anyone who knows the code can see what is shared. An invite link is just the code in a URL, so the same applies; an old link stops working when its session ends, but the code may go to a new session 10 minutes later. Don't use it for payment codes, login codes or other sensitive QR codes.

## Development

Requires Node.js 22 or later.

```bash
npm install
npm run dev        # http://localhost:3000, restarts when server code changes
npm test           # unit and integration tests (node:test)
```

The front end is plain ES modules with no build step; reload the page to see changes. Browsers only allow the camera on HTTPS or `localhost`, so testing on a phone needs an HTTPS deployment.

## Deployment

The recommended way is to deploy to an Ubuntu server with the scripts in `deploy/`. They install a checksum-verified official Node.js build, Caddy (which gets the HTTPS certificate automatically) and a locked-down systemd service.

### Requirements

- An **Ubuntu 24.04** server (x86_64 or ARM64) you can reach over SSH as root or as a user that can sudo without a password.
- A **domain** whose A record (and AAAA record, if the server has IPv6) points at the server.
- **Ports 80 and 443** open in your cloud provider's firewall or security group (TCP; also 443/UDP for HTTP/3).
- **Node.js 22 or later**, git and rsync on your computer (macOS and most Linux distributions include rsync).

> Servers in mainland China can only serve websites on ports 80/443 for domains with an ICP filing.

### Steps

Run these commands on your computer. Replace `myserver` with your SSH destination (such as `root@203.0.113.10`, or an alias from `~/.ssh/config`) and `qr.example.com` with your domain.

```bash
# 1. Get the code and install dependencies (releases run the tests locally first)
git clone https://github.com/InkCitrus/QRipple.git
cd QRipple
npm install

# 2. Set up the server: Node.js, Caddy and the systemd service, plus the HTTPS certificate
ssh myserver 'mkdir -p qripple-deploy'
scp deploy/* myserver:qripple-deploy/
ssh -t myserver 'sudo DOMAIN=qr.example.com bash qripple-deploy/setup-server.sh'

# 3. Ship the code and start the service (tests, upload, install dependencies, restart)
deploy/deploy.sh myserver
```

Then open `https://qr.example.com`. To check from the command line, `curl https://qr.example.com/healthz` prints `ok`. The certificate is usually ready within a minute.

### Maintenance

| Task | Command |
| --- | --- |
| Release a new version | `git pull && deploy/deploy.sh myserver` |
| Follow the logs | `ssh myserver journalctl -u qripple -f` |
| Restart the service | `ssh myserver sudo systemctl restart qripple` |
| Change settings | On the server, put environment variables (see Configuration below) in `/etc/qripple/qripple.env` (create it if needed, one `NAME=value` per line), then restart the service |
| Upgrade Node.js | Repeat step 2 with `NODE_VERSION=v24.x.y` added after `sudo`, then run `deploy/deploy.sh myserver` |

Restarting the service ends the sessions in progress (they only live in memory).

**Troubleshooting**

- **The site doesn't load, or there's no certificate**: check that the domain points at the server and ports 80/443 are open, then read Caddy's log: `ssh myserver journalctl -u caddy -n 50`.
- **Releasing asks for a sudo password**: `deploy.sh` can't type one. Log in as root, or let the user sudo without a password.
- **The camera doesn't work**: the page must be opened over HTTPS.

### Multiple access lines (nginx + Tailscale)

In some regions a single network route isn't reliable. A multi-line deployment serves the site from several servers on different networks, each server being one line; clients try the lines in parallel and use whichever connects first. It is more involved, and the single-server setup above is usually enough. The hosted instance uses two servers:

```
                      ┌─ tk.qripple.inkorange.com ─► vps-tk    (UCloud)    nginx ─┐
browsers race         ┤                                                          ├─ Tailscale ─► primary QRipple (vps-azure)
both lines            └─ az.qripple.inkorange.com ─► vps-azure (Microsoft) nginx ─┘               backup (vps-tk)
page qripple.inkorange.com: two A records, one per server
```

- **Racing lines**: clients get the line list from `/lines.json` and try the last line that worked first. If it hasn't connected within 0.6 seconds, the next line is tried in parallel, and the first to connect wins. On reconnect, the line that just dropped goes last. See `public/js/connection.js`.
- **One session across lines**: every line forwards to the same primary QRipple process (over Tailscale when it is on another server), so a sharer and a receiver on different lines still meet in one session. If the primary is unreachable, every line switches to the same backup process. There can only be one backup: nginx spreads requests over several backups, which would split a session between processes. Sessions live only in memory, so restarting the primary ends the sessions in progress.
- **Certificates**: each server uses certbot (webroot) for the main domain plus its own line's domain. The main domain resolves to every server, so an ACME challenge that lands on another server is passed over Tailscale to the other servers in turn until it reaches the one that asked.

**Requirements**

- Two or more Ubuntu 24.04 servers; otherwise the same requirements as a single server. nginx can be shared with other sites: the script only adds a `qripple` site.
- All servers on the same [Tailscale](https://tailscale.com) network. Note each one's Tailscale address (`tailscale ip -4`).
- One server runs the primary process and another the backup. The examples use three servers: A (primary, `100.64.0.1`), B (backup, `100.64.0.2`) and C (line only, `100.64.0.3`). With two servers, leave out C.
- Domain names (using `qr.example.com` as the example):
  - `qr.example.com`: one A record per server (the address people open);
  - one line domain per server: `a.qr.example.com` pointing at A, `b.qr.example.com` at B, `c.qr.example.com` at C.

Settings per server (`MAIN_NAME` and `ACCESS_LINES` are the same everywhere):

| Setting | A (primary) | B (backup) | C (line only) |
| --- | --- | --- | --- |
| `LINE_NAME` | `a.qr.example.com` | `b.qr.example.com` | `c.qr.example.com` |
| `LISTEN_HOSTS` | `127.0.0.1,100.64.0.1` | `127.0.0.1,100.64.0.2` | `127.0.0.1` |
| `PRIMARY` | `127.0.0.1:3000` | `100.64.0.1:3000` | `100.64.0.1:3000` |
| `BACKUP` | `100.64.0.2:3000` | `127.0.0.1:3000` | `100.64.0.2:3000` |
| `PEERS` (every other server) | `100.64.0.2,100.64.0.3` | `100.64.0.1,100.64.0.3` | `100.64.0.1,100.64.0.2` |

**Steps**

```bash
# 1. On your computer: get the code, install dependencies, copy deploy/ to every server
git clone https://github.com/InkCitrus/QRipple.git && cd QRipple && npm install
for h in serverA serverB serverC; do ssh $h 'mkdir -p qripple-deploy' && scp deploy/* $h:qripple-deploy/; done
```

```bash
# 2. On each server, with the settings from the table. Server A:
sudo MAIN_NAME=qr.example.com \
     ACCESS_LINES=a.qr.example.com,b.qr.example.com,c.qr.example.com \
     LINE_NAME=a.qr.example.com LISTEN_HOSTS=127.0.0.1,100.64.0.1 \
     PRIMARY=127.0.0.1:3000 BACKUP=100.64.0.2:3000 PEERS=100.64.0.2,100.64.0.3 \
     bash qripple-deploy/setup-line.sh

# Server B:
sudo MAIN_NAME=qr.example.com \
     ACCESS_LINES=a.qr.example.com,b.qr.example.com,c.qr.example.com \
     LINE_NAME=b.qr.example.com LISTEN_HOSTS=127.0.0.1,100.64.0.2 \
     PRIMARY=100.64.0.1:3000 BACKUP=127.0.0.1:3000 PEERS=100.64.0.1,100.64.0.3 \
     bash qripple-deploy/setup-line.sh

# Server C:
sudo MAIN_NAME=qr.example.com \
     ACCESS_LINES=a.qr.example.com,b.qr.example.com,c.qr.example.com \
     LINE_NAME=c.qr.example.com LISTEN_HOSTS=127.0.0.1 \
     PRIMARY=100.64.0.1:3000 BACKUP=100.64.0.2:3000 PEERS=100.64.0.1,100.64.0.2 \
     bash qripple-deploy/setup-line.sh
```

```bash
# 3. On your computer: ship the code to every server
deploy/deploy.sh serverA serverB serverC
```

4. Once DNS has propagated, run each server's command from step 2 again with `--issue-cert` added at the end. This gets the certificates and turns on HTTPS. Then open `https://qr.example.com`.

To release new versions: `deploy/deploy.sh serverA serverB serverC`. `setup-line.sh` writes its settings to `/etc/qripple/qripple.env`; running it again only updates the settings it manages and keeps any others you added.

**Adding a server later** (say D)

1. Add the line domain `d.qr.example.com` pointing at D.
2. On every existing server, run its step 2 command again with D's line domain added to `ACCESS_LINES` and D's Tailscale address added to `PEERS` (no `--issue-cert` needed; existing certificates are unaffected).
3. Copy `deploy/` to D and run `setup-line.sh` the way C does (`PEERS` listing every other server), then run `deploy/deploy.sh` for all servers so the new line list takes effect (this ends the sessions in progress).
4. Run D's command again with `--issue-cert`, and finally add an A record for `qr.example.com` pointing at D.

### Other environments

QRipple only needs Node.js 22 or later, so it can also run by hand behind an existing reverse proxy. The proxy must handle HTTPS and pass WebSocket connections through (path `/ws`; health check `/healthz`):

```bash
npm ci --omit=dev
HOST=127.0.0.1 PORT=3000 TRUST_PROXY=1 node server/index.js
```

### Configuration

Everything is configured with environment variables (see `server/config.js`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Address to listen on; comma-separate several |
| `PORT` | `3000` | Port to listen on |
| `TRUST_PROXY` | `0` | How many reverse-proxy hops to trust in `X-Forwarded-For` (used for per-IP limits); set to `1` behind one reverse proxy |
| `ALLOWED_ORIGINS` | empty | Extra WebSocket origins to allow besides the page's own host (comma-separated) |
| `ACCESS_LINES` | empty | Line domains for a multi-line deployment (comma-separated); when empty, clients only connect to the page's own host |
| `SESSION_TTL_MS` / `HOST_GRACE_MS` / `CODE_COOLDOWN_MS` | 24 hours / 2 minutes / 10 minutes | See Session rules |
| `MAX_SESSIONS` / `MAX_RECEIVERS` | `2000` / `50` | Concurrent sessions; receivers per session |
| `MAX_DATA_BYTES` / `MAX_MESSAGE_BYTES` | `8192` / `49152` | Size limit for one QR payload; for one WebSocket message |
| `MAX_CONNECTIONS_PER_IP` | `20` | Concurrent connections per IP |
| `CREATE_BURST` / `CREATE_REFILL_MS` | `10` / `60000` | Token bucket for creating sessions, per IP |
| `JOIN_FAIL_BURST` / `JOIN_FAIL_REFILL_MS` | `10` / `30000` | Token bucket for wrong pairing codes, per IP |
| `MESSAGE_BURST` / `MESSAGE_REFILL_MS` | `40` / `50` | Message rate per connection |
| `HEARTBEAT_MS` / `SWEEP_MS` | `30000` / `5000` | WebSocket heartbeat interval; expired-session sweep interval |

## Project layout

```
server/
  index.js           entry point: starts the server, handles shutdown signals
  app.js             HTTP server, WebSocket upgrade and Origin check, /lines.json, /healthz
  hub.js             WebSocket protocol (sharer and receiver messages)
  sessions.js        in-memory session store and pairing-code allocation
  ratelimit.js       token-bucket rate limiting
  static.js          static file server (in-memory cache + gzip) and security headers
  config.js          configuration from environment variables
public/              browser app (plain ES modules, no build step)
  js/app.js          client-side routing
  js/share.js        sharer page
  js/join.js         receiver page
  js/scanner.js      camera, viewfinder cropping and auto zoom
  js/scan-worker.js  QR decoding in a Web Worker (ZXing WASM, jsQR fallback)
  js/code-tracker.js decides which code to share when several are in view
  js/auto-zoom.js    auto-zoom decisions
  js/qr-render.js    regenerates the QR code for receivers (SVG)
  js/connection.js   WebSocket connection, line racing and reconnection
  js/linkify.js      finds web links in the content
  js/launch.js       system sharing and Shortcuts
  js/i18n.js         Chinese and English text
docs/PROTOCOL.md     WebSocket message reference
deploy/              deployment scripts, systemd unit, Caddy / nginx config
test/                node:test tests
```

## Contributing

Issues and pull requests are welcome. Please run `npm test` before submitting; the pure-logic modules (such as `code-tracker.js` and `linkify.js`) have unit tests, so update them along with your change.

## License

[Apache-2.0](LICENSE). Notices for the third-party components the site sends to browsers (jsQR, qrcode-generator, zxing-wasm and icons) are in [public/third-party-notices.txt](public/third-party-notices.txt), linked as "Open-source licenses" in the site's footer; update it when adding or upgrading such a dependency.
