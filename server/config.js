// Runtime configuration. Every value can be overridden with an environment
// variable; tests pass overrides directly to createApp().

function int(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function list(env, name) {
  const raw = env[name];
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(env = process.env) {
  return {
    port: int(env, 'PORT', 3000),
    // One or more addresses to listen on, e.g. "127.0.0.1,100.64.0.1"
    // (local reverse proxy plus the Tailscale address peers proxy to).
    hosts: list(env, 'HOST').length ? list(env, 'HOST') : ['0.0.0.0'],

    // Sessions
    // Sessions normally end when the sharer ends them or stays offline past
    // hostGraceMs. This hidden cap only stops a sharer page left open forever
    // from keeping a session (and its code) alive indefinitely.
    sessionTtlMs: int(env, 'SESSION_TTL_MS', 24 * 60 * 60 * 1000),
    hostGraceMs: int(env, 'HOST_GRACE_MS', 2 * 60 * 1000), // sharer offline -> session ends
    codeCooldownMs: int(env, 'CODE_COOLDOWN_MS', 10 * 60 * 1000), // ended codes are not reused for this long
    maxSessions: int(env, 'MAX_SESSIONS', 2000),
    maxReceivers: int(env, 'MAX_RECEIVERS', 50),

    // Payload limits. A QR code holds at most 7089 numeric characters, which
    // jsQR reports as 7089 bytes, so 8 KiB covers every valid symbol.
    maxDataBytes: int(env, 'MAX_DATA_BYTES', 8192),
    maxMessageBytes: int(env, 'MAX_MESSAGE_BYTES', 48 * 1024),

    // Abuse protection (per client IP)
    maxConnectionsPerIp: int(env, 'MAX_CONNECTIONS_PER_IP', 20),
    createBurst: int(env, 'CREATE_BURST', 10),
    createRefillMs: int(env, 'CREATE_REFILL_MS', 60 * 1000),
    joinFailBurst: int(env, 'JOIN_FAIL_BURST', 10),
    joinFailRefillMs: int(env, 'JOIN_FAIL_REFILL_MS', 30 * 1000),
    messageBurst: int(env, 'MESSAGE_BURST', 40),
    messageRefillMs: int(env, 'MESSAGE_REFILL_MS', 50), // ~20 msg/s sustained

    // Housekeeping
    heartbeatMs: int(env, 'HEARTBEAT_MS', 30 * 1000),
    sweepMs: int(env, 'SWEEP_MS', 5 * 1000),

    // Number of reverse-proxy hops to trust for X-Forwarded-For (0 = ignore header)
    trustProxy: int(env, 'TRUST_PROXY', 0),
    // Extra allowed WebSocket origins besides the page's own host
    allowedOrigins: list(env, 'ALLOWED_ORIGINS'),
    // Access lines: hostnames that all reach this same server (through
    // different networks). Clients race them and use whichever connects
    // first. Empty: clients only use the page's own host.
    lines: list(env, 'ACCESS_LINES'),
  };
}
