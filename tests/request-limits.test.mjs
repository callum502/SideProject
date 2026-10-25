import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  createRequestLimits,
  clientAddress,
  readRequestBody,
  REQUEST_LIMITS,
  testLimitOptions,
} from '../server/request-limits.mjs';
import { createGuideServer } from '../server/app.mjs';
import { fakeAuth } from './fake-auth.mjs';
import { createMemorySessionStore } from '../server/session-store.mjs';

test('rate windows, account and media limits, and bounded memory', () => {
  let time = 100000;
  const rules = Object.fromEntries(Object.entries(REQUEST_LIMITS).map(([k, v]) => [k, { ...v, count: 2 }]));
  const limiter = createRequestLimits({ now: () => time, rules });
  limiter.before('a', '/api/guide', 'GET');
  limiter.before('a', '/api/guide', 'GET');
  assert.throws(
    () => limiter.before('a', '/api/guide', 'GET'),
    e => e.status === 429 && e.retryAfter === 60
  );
  time += 60000;
  limiter.before('a', '/api/guide', 'GET');
  limiter.account('user', '/api/guide', 'GET');
  limiter.account('user', '/api/guide', 'GET');
  assert.throws(
    () => limiter.account('user', '/api/guide', 'GET'),
    e => e.status === 429
  );
  // Media redirects have their own limit, apart from the API's.
  limiter.media('a');
  limiter.media('a');
  assert.throws(
    () => limiter.media('a'),
    e => e.status === 429
  );
  const bounded = createRequestLimits({ maxKeys: 1 });
  bounded.before('a', '/api/guide', 'GET');
  assert.throws(
    () => bounded.before('b', '/api/guide', 'GET'),
    e => e.status === 503
  );
  const single = createRequestLimits({ maxActive: 1 }),
    release = single.enter();
  assert.throws(
    () => single.enter(),
    e => e.status === 503
  );
  release();
  release();
  single.enter()();
});

test('relaxed browser-test limits are refused outside local development', () => {
  const local = { E2E_RELAX_LIMITS: '1', SUPABASE_URL: 'http://127.0.0.1:54321' };
  assert.deepEqual(testLimitOptions({ SUPABASE_URL: local.SUPABASE_URL }), {}, 'unset keeps the real limits');
  assert.equal(testLimitOptions(local).rules.auth.count, REQUEST_LIMITS.auth.count * 100);
  assert.throws(() => testLimitOptions({ ...local, NODE_ENV: 'production' }), /production/);
  assert.throws(() => testLimitOptions({ ...local, RENDER: 'true' }), /production/);
  assert.throws(() => testLimitOptions({ ...local, SUPABASE_URL: 'https://project.supabase.co' }), /local Supabase/);
  assert.throws(() => testLimitOptions({ E2E_RELAX_LIMITS: '1' }), /local Supabase/);
});

test('untrusted forwarded headers are ignored and IPv6 addresses share a /64', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.2, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(clientAddress(req), '127.0.0.1');
  assert.equal(clientAddress(req, true), '203.0.113.2');
  req.headers['x-forwarded-for'] = 'invalid';
  assert.equal(clientAddress(req, true), '127.0.0.1');
  req.socket.remoteAddress = '2001:db8:0:1::1';
  const key = clientAddress(req);
  req.socket.remoteAddress = '2001:db8:0:1::abcd';
  assert.equal(clientAddress(req), key);
});

test('body reader bounds size, stalls, total duration, and aborted uploads', async () => {
  function stream() {
    const req = new PassThrough();
    req.headers = {};
    return req;
  }
  let req = stream(),
    pending = readRequestBody(req, 3);
  req.end('abc');
  assert.equal((await pending).toString(), 'abc');
  req = stream();
  pending = readRequestBody(req, 2);
  req.end('abc');
  await assert.rejects(pending, e => e.status === 413);
  req = stream();
  pending = readRequestBody(req, 3);
  req.emit('aborted');
  await assert.rejects(pending, e => e.status === 400);
  // Keep the test alive while the production timers are unref'd.
  const hold = setInterval(() => {}, 100);
  try {
    req = stream();
    await assert.rejects(readRequestBody(req, 3, { idleMs: 10, totalMs: 100 }), e => e.status === 408);
    req = stream();
    await assert.rejects(readRequestBody(req, 3, { idleMs: 100, totalMs: 10 }), e => e.status === 408);
  } finally {
    clearInterval(hold);
  }
});

test('HTTP rejects excess requests before Supabase and keeps health checks available', async () => {
  let reads = 0;
  const rules = { ...REQUEST_LIMITS, ip: { count: 1, window: 60000 } };
  const { server } = await createGuideServer({
    auth: fakeAuth(),
    contentStore: {
      summaries: async () => {
        reads++;
        return { locations: [] };
      },
    },
    requestLimits: createRequestLimits({ rules }),
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(base + '/api/locations')).status, 200);
    const rejected = await fetch(base + '/api/locations', { headers: { 'X-Forwarded-For': '198.51.100.1' } });
    assert.equal(rejected.status, 429);
    assert.equal(rejected.headers.get('retry-after'), '60');
    assert.equal(reads, 1);
    assert.equal((await fetch(base + '/healthz')).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});

test("uploads are signed into the user's own folder, and the file never passes through the server", async () => {
  const signed = [];
  const storage = {
    async signUpload(path, size, mime) {
      signed.push({ path, size, mime });
      return { uploadUrl: 'https://test.supabase.co/storage/v1/object/upload/sign/x?token=t', url: '/media/' + path };
    },
  };
  const auth = fakeAuth();
  const { server } = await createGuideServer({ auth, storage, contentStore: {}, sessions: createMemorySessionStore() });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const start = (value, cookie) =>
    fetch(base + '/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(value),
    });
  try {
    assert.equal((await start({ type: 'image/png', size: 10 })).status, 401);
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'contributor@example.com', password: 'test-password' }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const response = await start({ type: 'video/quicktime', size: 1000 }, cookie);
    assert.equal(response.status, 201);
    assert.match((await response.json()).uploadUrl, /^https:\/\/test\.supabase\.co\//);
    assert.match(signed[0].path, new RegExp('^' + auth.users.Contributor.id + '/[0-9a-f-]{36}\\.mov$'));
    assert.deepEqual([signed[0].size, signed[0].mime], [1000, 'video/quicktime']);
    for (const value of [
      { type: 'text/html', size: 10 },
      { type: 'image/png', size: -1 },
      { type: 'image/png', size: 1.5 },
    ])
      assert.equal((await start(value, cookie)).status, 400);
    assert.equal(signed.length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});
