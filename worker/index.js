import { loadConfig } from '../server/config.js';
import { originAllowed, parseLine, securityHeaders } from '../server/http-policy.js';

export { QRippleHub } from './hub.js';

const APP_ROUTE = /^(?:\/|\/share|\/join|\/\d{5})$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const config = loadConfig(env);
    const lines = config.lines.map(parseLine);
    const headers = securityHeaders(url.host, lines.map((line) => line.connectSrc));
    if (url.pathname === '/ws') {
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET' } });
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('WebSocket upgrade required', { status: 426, headers });
      }
      const allowed = [...config.allowedOrigins, ...lines.map((line) => line.origin)];
      if (!originAllowed(request.headers.get('Origin'), url.host, allowed)) {
        return new Response('Forbidden', { status: 403, headers });
      }
      // Every domain and every edge location must address the same object.
      // Only Cloudflare's trusted client IP header is used, never X-Forwarded-For.
      const internalHeaders = new Headers({
        Upgrade: 'websocket',
        'X-QRipple-IP': request.headers.get('CF-Connecting-IP') || 'unknown',
      });
      return env.QRIPPLE_HUB.getByName('global').fetch(new Request('https://hub/ws', { headers: internalHeaders }));
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
    }
    if (url.pathname === '/healthz') {
      return new Response(request.method === 'HEAD' ? null : 'ok', {
        headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    if (url.pathname === '/lines.json') {
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({ lines: lines.map(({ id, url }) => ({ id, url })) }), {
        headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      });
    }

    const appRoute = APP_ROUTE.test(url.pathname);
    if (appRoute) url.pathname = '/index.html';
    // Fetch HTML as GET so HEAD carries the same headers as its GET response.
    const asset = await env.ASSETS.fetch(new Request(url, { method: 'GET' }));
    const responseHeaders = new Headers(asset.headers);
    for (const [name, value] of Object.entries(headers)) responseHeaders.set(name, value);
    responseHeaders.set('Cache-Control', 'no-cache');
    let body = asset.body;
    if (asset.ok && responseHeaders.get('Content-Type')?.includes('text/html')) {
      const publicLines = lines.map(({ id, url }) => ({ id, url }));
      const json = JSON.stringify(publicLines).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      body = (await asset.text()).replace('<meta name="qripple-lines" content="">', `<meta name="qripple-lines" content="${json}">`);
      responseHeaders.delete('Content-Length');
      responseHeaders.delete('ETag');
    }
    return new Response(request.method === 'HEAD' ? null : body, { status: asset.status, headers: responseHeaders });
  },
};
