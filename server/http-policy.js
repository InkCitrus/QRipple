// Shared by the Node.js and Workers HTTP entry points.
export function originAllowed(origin, host, allowedOrigins) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function parseLine(entry) {
  const url = new URL(entry.includes('://') ? entry : `wss://${entry}/ws`);
  return {
    id: url.hostname.split('.')[0],
    url: url.href,
    origin: `${url.protocol === 'ws:' ? 'http:' : 'https:'}//${url.host}`,
    connectSrc: `${url.protocol}//${url.host}`,
  };
}

export function securityHeaders(host, connectSrc = []) {
  const sources = ["'self'"];
  if (host) sources.push(`wss://${host}`, `ws://${host}`);
  sources.push(...connectSrc);
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      `connect-src ${[...new Set(sources)].join(' ')}`,
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}
