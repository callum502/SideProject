import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStore } from '../session-store.mjs';

const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' };
const session = (overrides = {}) => ({
  accessToken: 'access-secret',
  refreshToken: 'refresh-secret',
  expires: Date.now() + 3600000,
  user: { id: '00000000-0000-4000-8000-000000000002', name: 'Me' },
  cookieExpires: Date.now() + 86400000,
  ...overrides,
});

// A fake database implementing the app session functions, shared by every store built on it.
function database() {
  const rows = new Map();
  const calls = [];
  const fetchImpl = async (url, options) => {
    const name = url.split('/rpc/')[1];
    const body = JSON.parse(options.body);
    calls.push({ name, body, authorization: options.headers.Authorization });
    if (name === 'create_app_session') rows.set(body.session_id, body.payload);
    if (name === 'update_app_session') rows.set(body.session_id, body.payload);
    if (name === 'delete_app_session') rows.delete(body.session_id);
    const reply = name === 'read_app_session' ? (rows.get(body.session_id) ?? null) : null;
    return new Response(JSON.stringify(reply));
  };
  return { rows, calls, store: () => createSessionStore({ env, fetchImpl }) };
}

test('sessions survive a restart, and the database holds neither the cookie nor the tokens', async () => {
  const db = database();
  const token = await db.store().create(session());
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(db.calls[0].authorization, 'Bearer access-secret');
  const [[id, payload]] = db.rows;
  assert.notEqual(id, token);
  for (const secret of ['access-secret', 'refresh-secret', token])
    assert.ok(!payload.includes(secret) && !Buffer.from(payload, 'base64').includes(secret));
  // A new server process starts with an empty cache and reads the session back from the database.
  const restored = await db.store().get(token);
  assert.equal(restored.refreshToken, 'refresh-secret');
  assert.equal(restored.user.id, session().user.id);
});

test('unknown, malformed, tampered and expired cookies have no session', async () => {
  const db = database();
  const store = db.store();
  const token = await store.create(session());
  const reads = () => db.calls.filter(c => c.name === 'read_app_session').length;
  for (const cookie of [undefined, '', 'not-a-session', 'x'.repeat(100)])
    assert.equal(await store.get(cookie), undefined);
  assert.equal(reads(), 0, 'Malformed cookies are refused without a database read');
  const other = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  assert.equal(await db.store().get(other), undefined);
  // A row decrypted with the wrong cookie fails its authentication check.
  const [[id, payload]] = db.rows;
  db.rows.set(id, payload.slice(0, -4) + (payload.endsWith('AAA=') ? 'BBB=' : 'AAA='));
  assert.equal(await db.store().get(token), undefined);
  const expired = await store.create(session({ cookieExpires: Date.now() - 1 }));
  assert.equal(await db.store().get(expired), undefined);
});

test('refreshed tokens are shared between servers, and logout removes the session everywhere', async () => {
  const db = database();
  const first = db.store(),
    second = db.store();
  const token = await first.create(session());
  const cached = await second.get(token);
  await first.update(token, session({ accessToken: 'new-access', refreshToken: 'new-refresh' }));
  // The second server's cache still has the old tokens until it asks for a fresh copy, and keeps the same object.
  assert.equal((await second.get(token)).refreshToken, 'refresh-secret');
  const fresh = await second.get(token, { fresh: true });
  assert.equal(fresh, cached);
  assert.equal(fresh.refreshToken, 'new-refresh');
  await first.remove(token);
  assert.equal(db.rows.size, 0);
  assert.equal(await db.store().get(token), undefined);
});
