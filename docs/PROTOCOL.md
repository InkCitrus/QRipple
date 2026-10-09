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
| `ping` | | anyone | Answered with `pong`. |

## Server → client

| `t` | Fields | To |
| --- | --- | --- |
| `created` | `code`, `sid`, `token`, `remainingMs` | sharer |
| `resumed` | `code`, `sid`, `remainingMs`, `receivers`, `rev` | sharer |
| `ack` | `rev` | sharer, after every `update` |
| `receivers` | `count` | sharer, when the count changes |
| `joined` | `code`, `sid`, `remainingMs`, `hostOnline`, `payload` | receiver |
| `payload` | `payload` | receivers, only when the data changed |
| `host` | `online` | receivers, when the sharer disconnects / returns |
| `left` | | receiver |
| `ended` | `reason`: `ended` \| `expired` \| `host_left` | everyone; the server then closes the socket |
| `error` | `code` | see below |
| `pong` | | |

`payload` = `{ rev, text, data, ageMs }`. `rev` increases with each change;
`ageMs` is how long ago the server received it.

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
