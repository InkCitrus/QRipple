# QRipple

[简体中文](README.md) | English

**Real-time QR Code Sharing** · *Scan once. Share everywhere.*

Try it: <https://qripple.inkorange.com>

QRipple is a website for sharing a QR code live, with no install and no sign-up. The sharer points their phone's camera at a QR code; receivers enter a 5-digit pairing code and see the same QR code on their own screens. When the code's content changes, every receiver updates at once.

**Only the decoded data is sent; camera images never leave the sharer's device.** The server keeps no records, and a session is gone as soon as it ends.

## How to use it

1. **Sharer**: open the site, tap *Start Sharing*, allow camera access and point the camera at the QR code. The page shows a 5-digit pairing code.
2. **Receiver**: open the site, tap *Join Session* and enter the pairing code to see the same QR code (regenerated on the device, ready to scan). Receivers can copy the content or pass a link in it to another app through the system share sheet.
3. The session ends, and its code stops working, when the sharer taps *End sharing* or stays offline for more than 2 minutes.

## Features

- **On-device decoding**: ZXing (WebAssembly) in a Web Worker in the sharer's browser, up to about 16 frames per second. Blurry frames get a sharpened second try; browsers without WebAssembly fall back to jsQR.
- **Changing QR codes**: new content is pushed to every receiver automatically, so codes that refresh every few seconds work. A new reading must be seen twice in a row before it replaces the old one, so a misread can't cause flicker.
- **Several QR codes**: when more than one code is in view, they are numbered on the preview for the sharer to pick, and the chosen code is followed from then on. Small codes next to a large one are found too.
- **Auto zoom**: a code the camera can see but not read is zoomed in on automatically (where the camera supports zoom).
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
- **The 5-digit pairing code is not strong authentication.** Wrong guesses are throttled, but anyone who knows the code can see what is shared. Don't use it for payment codes, login codes or other sensitive QR codes.

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

In some regions a single network route isn't reliable. A multi-line deployment serves the site from several servers on different networks; clients try the lines in parallel and use whichever connects first. It is more involved, and the single-server setup above is usually enough. The hosted instance is set up like this:

```
                      ┌─ tk.qripple.inkorange.com ─► vps-tk    (UCloud)    nginx ─┐
browsers race         ┤                                                          ├─ Tailscale ─► primary QRipple (vps-azure)
both lines            └─ az.qripple.inkorange.com ─► vps-azure (Microsoft) nginx ─┘               backup (vps-tk)
page qripple.inkorange.com: two A records, one per server
```

- **Racing lines**: clients get the line list from `/lines.json` and try the last line that worked first. If it hasn't connected within 0.6 seconds, the next line is tried in parallel, and the first to connect wins. On reconnect, the line that just dropped goes last. See `public/js/connection.js`.
- **One session across lines**: every line forwards to the same primary QRipple process (over Tailscale when it is on another server), so a sharer and a receiver on different lines still meet in one session. If the primary is unreachable, nginx switches to the backup. Sessions live only in the primary's memory, so restarting it ends the sessions in progress.
- **Certificates**: each server uses certbot (webroot) for the main domain plus its own line's domain. The main domain resolves to every server, so an ACME challenge that lands on the other server is forwarded to the requesting one over Tailscale.
- **Setting up a line**: first join every server to the same Tailscale network. Copy `deploy/` to the server as in step 2 and run `setup-line.sh`, with environment variables for the main domain, all line domains, this line's domain, the listen addresses, the primary and backup processes, and the peer address (explained, with an example, at the top of the script). Once DNS points at the server, run it again with `--issue-cert` to enable HTTPS. The script only adds a `qripple` site to nginx, so the server can host other sites too. The resulting settings are in `/etc/qripple/qripple.env`.
- **Releasing**: `deploy/deploy.sh server1 server2 ...` (with no arguments it releases to the hosted instance's `vps-azure` and `vps-tk`).

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

[Apache-2.0](LICENSE)
