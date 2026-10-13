# WebSocket protocol

Endpoint: `GET /ws` (same origin as the page). Every frame is a JSON object
with a `t` (type) field. A socket takes one role, sharer (`host`) or
receiver, for one session at a time.

## Client → server

| `t` | Fields | Who | Notes |
| --- | --- | --- | --- |
| `create` | | anyone | Creates a session; the socket becomes its sharer. |
| `resume` | `sid`, `token` | sharer | Reattach after a reconnect or page reload. |
| `update` | `text`, `data` | sharer | `data` = canonical base64 of the decoded bytes (≤ 8 KiB); `text` = decoder's text. |
| `end` | | sharer | Ends the session for everyone. |
| `join` | `code`, `sid?` | anyone | `code` = 5 digits. Reconnecting receivers pass the `sid` they joined before. |
| `leave` | | receiver | |
| `ping` | `id?` | anyone | Answered with `pong`; optional safe-integer ID correlates a timing probe. |

## Server → client

| `t` | Fields | To |
| --- | --- | --- |
| `created` | `code`, `sid`, `token`, `remainingMs` | sharer |
| `resumed` | `code`, `sid`, `remainingMs`, `receivers`, `rev` | sharer |
| `ack` | `rev`, `ageMs` | sharer, after every `update`, including unchanged content |
| `receivers` | `count` | sharer, when the count changes |
| `joined` | `code`, `sid`, `remainingMs`, `hostOnline`, `payload` | receiver |
| `payload` | `payload` | receivers, only when the data changed |
| `host` | `online` | receivers, when the sharer disconnects / returns |
| `left` | | receiver |
| `ended` | `reason`: `ended` \| `expired` \| `host_left` | everyone; the server then closes the socket |
| `error` | `code` | see below |
| `pong` | `id?`, `timing?` | requesting socket; timing only for its bound session |

`payload` = `{ rev, text, data, ageMs }`. `rev` increases with each change;
`ageMs` is how long ago the server received it.

`timing` = `{ rev, ageMs }` for the bound session's current payload, omitted
when no payload or session exists. `pong.id` echoes a valid `ping.id`.
Unchanged updates retain the original payload age. A changed payload starts
a new revision and age.

The browser anchors `ageMs` to `performance.now()` and adds half the measured
ping round trip to estimate transit time, without comparing device clocks.
It calibrates on connection, every 10 seconds, and on returning to the page;
calibration only applies to the currently displayed revision. Both views update
elapsed text every 250 ms, rounded to the nearest second. This targets sub-second
display error under normal scheduling and reasonably symmetric network delay;
severe latency asymmetry or a suspended browser can exceed that target.

### Error codes

| `code` | Meaning |
| --- | --- |
| `bad_request` | Malformed message or wrong state for this socket |
| `not_found` | No active session with that code (counts toward the per-IP failure limit) |
| `session_ended` | `resume` with a bad sid/token, or `join` with a `sid` that no longer matches |
| `full` | Session reached its receiver limit |
| `rate_limited` | Too many failed joins / creates from this IP, or too many messages on this socket |
| `too_large` | `update` data missing, not canonical base64, or over the size limit |
| `forbidden` | Only the session's current sharer may `update` / `end` |
| `busy` | Server is at its session limit |
| `replaced` | Another connection resumed this sharer session |
