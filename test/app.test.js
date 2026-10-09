const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createApp } = require('../src/app');

function requestJson(baseUrl, pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
}

function waitForStreamEvent(baseUrl, sessionId) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}/api/sessions/${sessionId}/stream`, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
    });

    let buffer = '';
    req.on('response', (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buffer += chunk;
        const marker = '\n\n';
        const idx = buffer.indexOf(marker);
        if (idx !== -1) {
          const eventText = buffer.slice(0, idx);
          const match = eventText.match(/^data:\s*(.+)$/m);
          if (match) {
            res.destroy();
            resolve(JSON.parse(match[1]));
          }
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('creates and retrieves a share session with QR payload', async () => {
  const app = createApp({ staticDir: path.join(__dirname, '..', 'public') });
  const server = app.createServer();

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const created = await requestJson(baseUrl, '/api/sessions', { method: 'POST' });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.ok(createdBody.sessionId);

    const fetched = await requestJson(baseUrl, `/api/sessions/${createdBody.sessionId}`);
    assert.equal(fetched.status, 200);

    const body = await fetched.json();
    assert.equal(body.sessionId, createdBody.sessionId);
    assert.equal(typeof body.content, 'string');
    assert.match(body.qrDataUrl, /^data:image\/png;base64,/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('shares updates to stream subscribers in real time', async () => {
  const app = createApp({ staticDir: path.join(__dirname, '..', 'public') });
  const server = app.createServer();

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const created = await requestJson(baseUrl, '/api/sessions', { method: 'POST' });
    const { sessionId } = await created.json();

    const initialEvent = await waitForStreamEvent(baseUrl, sessionId);
    assert.equal(initialEvent.content, 'https://example.com');

    const sharedValue = 'https://github.com/InkCitrus/QRipple';
    const updatedEventPromise = waitForStreamEvent(baseUrl, sessionId);

    const shared = await requestJson(baseUrl, `/api/sessions/${sessionId}/share`, {
      method: 'POST',
      body: JSON.stringify({ content: sharedValue }),
    });

    assert.equal(shared.status, 200);
    const updatedEvent = await updatedEventPromise;
    assert.equal(updatedEvent.content, sharedValue);

    const fetched = await requestJson(baseUrl, `/api/sessions/${sessionId}`);
    const fetchedBody = await fetched.json();
    assert.equal(fetchedBody.content, sharedValue);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

