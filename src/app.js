const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const QRCode = require('qrcode');

const MAX_CONTENT_LENGTH = 1024;
const MAX_BODY_BYTES = 8 * 1024;

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function validateContent(content) {
  if (typeof content !== 'string') {
    return 'content must be a string';
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return 'content cannot be empty';
  }

  if (trimmed.length > MAX_CONTENT_LENGTH) {
    return `content must be ${MAX_CONTENT_LENGTH} characters or fewer`;
  }

  return null;
}

function buildShareUrl(req, sessionId) {
  const host = req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${host}/?session=${encodeURIComponent(sessionId)}`;
}

function createApp({ staticDir = path.join(process.cwd(), 'public') } = {}) {
  const sessions = new Map();

  async function buildSessionResponse(req, session) {
    const qrDataUrl = await QRCode.toDataURL(session.content);
    return {
      sessionId: session.id,
      content: session.content,
      updatedAt: session.updatedAt,
      qrDataUrl,
      shareUrl: buildShareUrl(req, session.id),
    };
  }

  function getSession(sessionId) {
    return sessions.get(sessionId);
  }

  function sendEvent(client, data) {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/') {
      const htmlPath = path.join(staticDir, 'index.html');
      const html = await fs.readFile(htmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      const id = randomUUID();
      const session = {
        id,
        content: 'https://example.com',
        updatedAt: new Date().toISOString(),
        clients: new Set(),
      };
      sessions.set(id, session);
      json(res, 201, {
        sessionId: id,
        shareUrl: buildShareUrl(req, id),
      });
      return;
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    const streamMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
    const shareMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/share$/);

    if (req.method === 'GET' && sessionMatch) {
      const session = getSession(sessionMatch[1]);
      if (!session) {
        json(res, 404, { error: 'Session not found' });
        return;
      }

      json(res, 200, await buildSessionResponse(req, session));
      return;
    }

    if (req.method === 'GET' && streamMatch) {
      const session = getSession(streamMatch[1]);
      if (!session) {
        json(res, 404, { error: 'Session not found' });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      sendEvent(res, {
        content: session.content,
        updatedAt: session.updatedAt,
      });

      session.clients.add(res);
      req.on('close', () => {
        session.clients.delete(res);
      });
      return;
    }

    if (req.method === 'POST' && shareMatch) {
      const session = getSession(shareMatch[1]);
      if (!session) {
        json(res, 404, { error: 'Session not found' });
        return;
      }

      let payload;
      try {
        payload = await parseBody(req);
      } catch (error) {
        json(res, 400, { error: error.message });
        return;
      }

      const validationError = validateContent(payload.content);
      if (validationError) {
        json(res, 400, { error: validationError });
        return;
      }

      session.content = payload.content.trim();
      session.updatedAt = new Date().toISOString();

      const message = {
        content: session.content,
        updatedAt: session.updatedAt,
      };

      for (const client of session.clients) {
        sendEvent(client, message);
      }

      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { error: 'Not found' });
  }

  return {
    createServer() {
      return http.createServer((req, res) => {
        handler(req, res).catch((error) => {
          json(res, 500, { error: `Internal server error: ${error.message}` });
        });
      });
    },
  };
}

module.exports = {
  createApp,
  MAX_CONTENT_LENGTH,
};
