import { duplicateMediaName } from '../media-names.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuideServer, fullGuideOption } from '../server.mjs';
import { applyChanges } from '../guide-changes.mjs';
import { fakeAuth } from './fake-auth.mjs';
import { deploymentConfig } from '../deployment.mjs';
import { createMemorySessionStore } from '../session-store.mjs';
import http from 'node:http';

test('Render accepts configured HTTPS origins and sets secure cookies behind its proxy', async () => {
  const deployment = deploymentConfig({
    RENDER: 'true',
    RENDER_EXTERNAL_URL: 'https://sideproj.onrender.com',
    APP_ORIGINS: 'https://sideproj.rocks, https://www.sideproj.rocks',
  });
  assert.equal(deployment.host, '0.0.0.0');
  assert.equal(deploymentConfig({}).host, '127.0.0.1');
  assert.throws(() => deploymentConfig({ NODE_ENV: 'production' }));
  assert.throws(() => deploymentConfig({ APP_ORIGINS: 'http://sideproj.rocks' }));
  const { server } = await createGuideServer({
    deployment,
    auth: fakeAuth(),
    storage: {},
    contentStore: {},
    sessions: createMemorySessionStore(),
  });
  await new Promise(r => server.listen(0, deployment.host, r));
  const request = (route, host, origin, method = 'GET', value) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: server.address().port,
          path: route,
          method,
          headers: { Host: host, ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
        },
        res => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
        }
      );
      req.on('error', reject);
      req.end(value ? JSON.stringify(value) : undefined);
    });
  try {
    for (const host of ['sideproj.rocks', 'www.sideproj.rocks', 'sideproj.onrender.com'])
      assert.equal((await request('/api/session', host, 'https://' + host)).status, 200);
    assert.equal((await request('/api/session', 'evil.example')).status, 403);
    assert.equal((await request('/api/session', 'sideproj.rocks', 'https://evil.example')).status, 403);
    assert.equal((await request('/api/session', 'sideproj.rocks', 'http://sideproj.rocks')).status, 403);
    assert.equal((await request('/api/session', 'sideproj.rocks', 'https://www.sideproj.rocks')).status, 403);
    assert.equal((await request('/healthz', 'internal-probe')).status, 200);
    const login = await request('/api/login', 'sideproj.rocks', 'https://sideproj.rocks', 'POST', {
      email: 'contributor@example.com',
      password: 'test-password',
    });
    assert.equal(login.status, 200);
    assert.match(login.headers['set-cookie'][0], /; Secure/);
    const logout = await request('/api/logout', 'sideproj.rocks', 'https://sideproj.rocks', 'POST', {});
    assert.equal(logout.status, 200);
    assert.match(logout.headers['set-cookie'][0], /Max-Age=0; Secure/);
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});

test('cloud API requires login, forwards verified tokens, validates writes and invalidates logout', async () => {
  const auth = fakeAuth(),
    login = auth.login;
  auth.login = async credentials => ({ ...(await login(credentials)), accessToken: 'verified-token' });
  let saved;
  const contentStore = {
    async read() {
      return { locations: [] };
    },
    async save(changes, user, token, check) {
      const next = applyChanges({ locations: [] }, changes);
      check(next, { locations: [] });
      saved = { changes, user, token };
      return next;
    },
  };
  const { server } = await createGuideServer({
    auth,
    contentStore,
    storage: {},
    sessions: createMemorySessionStore(),
    fullGuide: true,
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (route, method = 'GET', value, cookie, headers = {}) =>
    fetch(base + route, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(value ? { body: JSON.stringify(value) } : {}),
    });
  try {
    assert.deepEqual(await request('/api/guide').then(r => r.json()), { locations: [] });
    assert.equal((await request('/api/guide', 'PUT', { changes: [] })).status, 401);
    assert.equal((await request('/api/uploads', 'POST', { type: 'image/png', size: 8 })).status, 401);
    assert.equal((await request('/api/login', 'POST', { email: 'admin@example.com', password: 'wrong' })).status, 401);
    const response = await request('/api/login', 'POST', {
      email: 'contributor@example.com',
      password: 'test-password',
    });
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.ok(response.headers.get('set-cookie').includes('HttpOnly'));
    const data = await response.json();
    assert.equal(data.user.role, 'contributor');
    assert.equal(data.accessToken, undefined);
    assert.equal((await request('/api/guide', 'PUT', { changes: [] }, cookie)).status, 200);
    assert.equal(saved.token, 'verified-token');
    assert.equal(saved.user.id, auth.users.Contributor.id);
    // The merged guide is validated, so an invalid new record is rejected; so is the old whole-guide format.
    assert.equal(
      (
        await request(
          '/api/guide',
          'PUT',
          { changes: [{ action: 'put', type: 'location', id: 'bad', parentId: null, base: null, value: {} }] },
          cookie
        )
      ).status,
      400
    );
    assert.equal((await request('/api/guide', 'PUT', { locations: [] }, cookie)).status, 400);
    assert.equal(
      (await request('/api/guide', 'PUT', { changes: [] }, cookie, { Origin: 'https://untrusted.example' })).status,
      403
    );
    for (const route of ['/api/storage/migration', '/api/media-settings', '/uploads/anything.png'])
      assert.equal((await request(route)).status, 404);
    await request('/api/logout', 'POST', {}, cookie);
    assert.equal((await request('/api/guide', 'PUT', { changes: [] }, cookie)).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});

test('media names reject existing and batch duplicates regardless of case or surrounding whitespace', () => {
  assert.equal(duplicateMediaName([{ name: 'Photo 1' }], [' photo 1 ']), ' photo 1 ');
  assert.equal(duplicateMediaName([], ['Beta', 'BETA']), 'BETA');
  assert.equal(duplicateMediaName([{ name: 'Photo 1' }], ['Photo 2', 'Photo 3']), null);
});

test('Google callback requires browser cookie, rejects replay and creates a server session', async () => {
  let exchanges = 0,
    challenge;
  const auth = fakeAuth();
  auth.googleUrl = (redirect, c) => {
    challenge = c;
    return 'https://test.supabase.co/auth/v1/authorize?redirect_to=' + encodeURIComponent(redirect);
  };
  auth.exchangeGoogle = async (code, verifier) => {
    exchanges++;
    assert.equal(code, 'valid');
    assert.ok(verifier.length >= 43);
    return { user: auth.users.Contributor, accessToken: 'private-token' };
  };
  const { server } = await createGuideServer({
    auth,
    storage: {},
    contentStore: {},
    sessions: createMemorySessionStore(),
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal(
      (await fetch(base + '/api/auth/google', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status,
      403
    );
    const start = await fetch(base + '/api/auth/google', { method: 'POST', headers: { Origin: base } });
    assert.equal(start.status, 200);
    const cookie = start.headers.get('set-cookie').split(';')[0];
    assert.match(start.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    assert.ok(challenge);
    const missing = await fetch(base + '/auth/google/callback?code=valid', { redirect: 'manual' });
    assert.equal(missing.headers.get('location'), '/?google_error=1#login');
    assert.equal(exchanges, 0);
    const done = await fetch(base + '/auth/google/callback?code=valid', {
      redirect: 'manual',
      headers: { Cookie: cookie },
    });
    assert.equal(done.headers.get('location'), '/#explore');
    assert.equal(exchanges, 1);
    assert.ok(!done.headers.get('set-cookie').includes('private-token'));
    const replay = await fetch(base + '/auth/google/callback?code=valid', {
      redirect: 'manual',
      headers: { Cookie: cookie },
    });
    assert.equal(replay.headers.get('location'), '/?google_error=1#login');
    assert.equal(exchanges, 1);
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});

test('post limits count across locations and do not block edits at the limit', async () => {
  const { enforcePostLimits } = await import('../post-limits.mjs');
  const make = count => ({
    locations: Array.from({ length: 25 }, (_, i) => ({
      id: 'l' + i,
      createdBy: 'me',
      boulders: Array.from({ length: i === 0 ? count : 0 }, (_, j) => ({ id: 'b' + j, createdBy: 'me', problems: [] })),
    })),
  });
  const old = make(50);
  assert.doesNotThrow(() => enforcePostLimits(old, structuredClone(old), 'me'));
  const next = make(50);
  next.locations[1].boulders.push({ id: 'extra', createdBy: 'me', problems: [] });
  assert.throws(() => enforcePostLimits(old, next, 'me'), /maximum 50 boulders/);
  const loc = make(50);
  loc.locations.push({ id: 'extra', createdBy: 'me', boulders: [] });
  assert.throws(() => enforcePostLimits(old, loc, 'me'), /maximum 25 locations/);
  const probs = make(50);
  for (let i = 0; i < 251; i++)
    probs.locations[i % 25].boulders.push({
      id: 'other' + i,
      createdBy: 'other',
      problems: [{ id: 'p' + i, createdBy: 'me' }],
    });
  assert.throws(() => enforcePostLimits(old, probs, 'me'), /maximum 250 problems/);
});

test('locations load one at a time and saves can be limited to one location', async () => {
  const auth = fakeAuth();
  const place = { id: '10000000-0000-4000-8000-000000000001', name: 'Crag', boulders: [] };
  let saved;
  const contentStore = {
    async summaries() {
      return { locations: [{ id: place.id, name: place.name, latitude: '1', longitude: '2' }] };
    },
    async readLocation(id) {
      return { locations: id === place.id ? [place] : [] };
    },
    async save(changes, user, token, check, locationId) {
      saved = locationId;
      return { locations: [place] };
    },
  };
  const { server } = await createGuideServer({ auth, contentStore, storage: {}, sessions: createMemorySessionStore() });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await (await fetch(base + '/api/locations')).json()).locations[0].name, 'Crag');
    assert.deepEqual(await (await fetch(base + '/api/locations/' + place.id)).json(), { locations: [place] });
    for (const id of ['20000000-0000-4000-8000-000000000002', 'not-a-uuid'])
      assert.equal((await fetch(base + '/api/locations/' + id)).status, 404);
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'contributor@example.com', password: 'test-password' }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const put = value =>
      fetch(base + '/api/guide', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(value),
      });
    assert.equal((await put({ changes: [], location: place.id })).status, 200);
    assert.equal(saved, place.id);
    // Without a location the save would cover the whole guide, which only admins may do.
    assert.equal((await put({ changes: [] })).status, 400);
    assert.equal((await put({ changes: [], location: 'elsewhere' })).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});

test('a save limited to one location refuses changes elsewhere, and checks new uploads by their contents', async () => {
  const { createContentStore } = await import('../content-store.mjs');
  const owner = '00000000-0000-4000-8000-000000000002';
  const target = '10000000-0000-4000-8000-000000000001';
  const row = {
    id: target,
    name: 'Crag',
    latitude: 1,
    longitude: 2,
    approach_notes: 'Walk',
    additional_links: [],
    created_by: owner,
    version: 1,
  };
  const snapshot = { locations: [row], boulders: [], problems: [], media: [], problem_media: [], profiles: [] };
  const calls = [];
  const fetchImpl = async (url, options) => {
    const name = url.split('/rpc/')[1];
    calls.push({ name, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(snapshot));
  };
  let contents = Buffer.from('not an image at all');
  const storage = {
    async inspect(path, token, head) {
      return { size: contents.length, mime: 'image/png', bytes: contents.subarray(0, head) };
    },
  };
  const store = createContentStore({
    env: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'key' },
    fetchImpl,
    storage,
  });
  const user = { id: owner, name: 'Me', role: 'contributor' };
  const base = { name: 'Crag', latitude: '1', longitude: '2', approach: 'Walk', links: [], createdBy: owner };
  const other = { action: 'put', type: 'location', id: '20000000-0000-4000-8000-000000000002', parentId: null };
  await assert.rejects(
    store.save([{ ...other, base: null, value: base }], user, 'token', () => {}, target),
    /one location at a time/
  );
  assert.deepEqual(
    calls.map(c => c.name),
    ['read_location']
  );
  const photo = {
    id: '30000000-0000-4000-8000-000000000003',
    name: 'Parking',
    caption: '',
    url: `/media/${owner}/40000000-0000-4000-8000-000000000004.png`,
    annotations: [],
    createdBy: owner,
  };
  const addPhoto = [{ action: 'put', type: 'photo', id: photo.id, parentId: target, base: null, value: photo }];
  await assert.rejects(
    store.save(addPhoto, user, 'token', () => {}, target),
    /not a supported image/
  );
  contents = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(100)]);
  calls.length = 0;
  await store.save(addPhoto, user, 'token', () => {}, target);
  const save = calls.find(c => c.name === 'save_content').body;
  assert.equal(save.target_location, target);
  assert.equal(save.operations.find(op => op.table === 'media').row.size_bytes, contents.length);
});

test('only admins (or browser tests) may read or save the whole guide at once', async () => {
  const auth = fakeAuth();
  const contentStore = {
    async read() {
      return { locations: [] };
    },
    async save() {
      return { locations: [] };
    },
  };
  const { server } = await createGuideServer({ auth, contentStore, storage: {}, sessions: createMemorySessionStore() });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const login = async email =>
    (
      await fetch(base + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'test-password' }),
      })
    ).headers
      .get('set-cookie')
      .split(';')[0];
  const read = cookie => fetch(base + '/api/guide', { headers: cookie ? { Cookie: cookie } : {} });
  const saveAll = cookie =>
    fetch(base + '/api/guide', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ changes: [] }),
    });
  try {
    const contributor = await login('contributor@example.com');
    const admin = await login('admin@example.com');
    assert.equal((await read()).status, 404);
    assert.equal((await read(contributor)).status, 404);
    assert.equal((await saveAll(contributor)).status, 400);
    assert.equal((await read(admin)).status, 200);
    assert.equal((await saveAll(admin)).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
  const local = { E2E_FULL_GUIDE: '1', SUPABASE_URL: 'http://127.0.0.1:54321' };
  assert.equal(fullGuideOption({}), false);
  assert.equal(fullGuideOption(local), true);
  assert.throws(() => fullGuideOption({ ...local, NODE_ENV: 'production' }));
  assert.throws(() => fullGuideOption({ ...local, RENDER: 'true' }));
  assert.throws(() => fullGuideOption({ ...local, SUPABASE_URL: 'https://project.supabase.co' }));
});
