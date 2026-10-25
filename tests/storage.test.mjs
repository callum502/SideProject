import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createStorage } from '../storage.mjs';
import { mediaReference, MAX_VIDEO_BYTES } from '../media-reference.mjs';
import { createGuideServer } from '../server.mjs';
import { fakeAuth } from './fake-auth.mjs';
import { createMemorySessionStore } from '../session-store.mjs';
import { matchesType, SIGNATURE_BYTES } from '../media-signatures.mjs';
const owner = '00000000-0000-4000-8000-000000000001';
const filename = '10000000-0000-4000-8000-000000000001.png';
const cloudPath = owner + '/' + filename;
const env = { MEDIA_STORE: 'supabase', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' };
// A fake Storage holding `objects` (path → { bytes, mime }): it signs upload URLs and serves ranged reads.
function fixture() {
  const objects = new Map();
  const calls = [];
  const storage = createStorage({
    env,
    fetchImpl: async (url, options) => {
      if (url.endsWith('/rest/v1/rpc/my_storage_usage'))
        return new Response(JSON.stringify({ usedBytes: 0, limitBytes: 10000000000 }));
      calls.push({ url, options });
      const key = url.split('sideproj-media/')[1];
      if (url.includes('/object/upload/sign/'))
        return new Response(JSON.stringify({ url: '/object/upload/sign/sideproj-media/' + key + '?token=t' }));
      const obj = objects.get(key);
      if (!obj) return new Response('{}', { status: 404 });
      const [, from, to] = options.headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number);
      return new Response(obj.bytes.subarray(from, to + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${from}-${to}/${obj.bytes.length}`, 'Content-Type': obj.mime },
      });
    },
  });
  return { storage, objects, calls };
}

test('signing an upload fails closed on quota checks and surfaces Storage quota rejection', async () => {
  for (const mode of ['full', 'missing', 'race']) {
    let signs = 0;
    const storage = createStorage({
      env,
      fetchImpl: async url => {
        if (url.endsWith('/rest/v1/rpc/my_storage_usage')) {
          if (mode === 'missing') return new Response(JSON.stringify({ code: 'PGRST202' }), { status: 404 });
          return new Response(
            JSON.stringify({ usedBytes: mode === 'full' ? 10000000000 : 0, limitBytes: 10000000000 })
          );
        }
        signs++;
        return new Response(JSON.stringify({ message: 'This upload would exceed your 10 GB upload allowance.' }), {
          status: 400,
        });
      },
    });
    await assert.rejects(
      storage.signUpload(cloudPath, 5, 'image/png', 'session'),
      mode === 'missing' ? /migration/ : /10 GB/
    );
    assert.equal(signs, mode === 'race' ? 1 : 0);
  }
});
test('signed uploads never overwrite existing objects, enforce size limits, and only accept safe cloud paths', async () => {
  const f = fixture();
  const signed = await f.storage.signUpload(cloudPath, 10, 'image/png', 'session');
  assert.equal(signed.url, '/media/' + cloudPath);
  assert.equal(
    signed.uploadUrl,
    `${env.SUPABASE_URL}/storage/v1/object/upload/sign/sideproj-media/${cloudPath}?token=t`
  );
  assert.equal(f.calls[0].options.headers['x-upsert'], 'false');
  assert.equal(f.calls[0].options.headers.Authorization, 'Bearer session');
  await assert.rejects(f.storage.signUpload('../' + cloudPath, 10, 'image/png', 'session'));
  await assert.rejects(
    f.storage.signUpload(cloudPath, 8 * 1024 * 1024 + 1, 'image/png', 'session'),
    e => e.status === 413
  );
  await assert.rejects(
    f.storage.signUpload(cloudPath, MAX_VIDEO_BYTES + 1, 'video/mp4', 'session'),
    error => error.status === 413
  );
  assert.equal(mediaReference('/media/../../secrets'), null);
  assert.equal(mediaReference('/uploads/' + filename), null);
  assert.equal(mediaReference('https://evil.example/file.png'), null);
  assert.equal(MAX_VIDEO_BYTES, 104857600);
});

test('inspecting a stored file reads only its leading bytes, and contents must match the declared type', async () => {
  const f = fixture();
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(10000)]);
  f.objects.set(cloudPath, { bytes: png, mime: 'image/png' });
  const info = await f.storage.inspect(cloudPath, 'session', SIGNATURE_BYTES);
  assert.deepEqual([info.size, info.mime, info.bytes.length], [png.length, 'image/png', SIGNATURE_BYTES]);
  assert.equal(f.calls[0].options.headers.Range, 'bytes=0-4095');
  assert.ok(matchesType('image/png', info.bytes));
  assert.ok(!matchesType('image/jpeg', info.bytes));
  assert.ok(!matchesType('image/png', Buffer.from('<html>not an image</html>')));
  assert.ok(matchesType('video/mp4', Buffer.from('\0\0\0\x18ftypmp42\0\0\0\0')));
  assert.ok(!matchesType('text/html', info.bytes));
});

test('HTTP cloud uploads do not write local files; retired migration endpoints are absent and playback redirects safely', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sideproj-storage-'));
  let server;
  try {
    const auth = fakeAuth();
    const baseLogin = auth.login;
    auth.login = async value => ({ ...(await baseLogin(value)), accessToken: 'token' });
    const f = fixture();
    const contentStore = {};
    ({ server } = await createGuideServer({
      auth,
      storage: f.storage,
      contentStore,
      sessions: createMemorySessionStore(),
    }));
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(base + '/api/storage/migration')).status, 404);
    async function login(email) {
      const r = await fetch(base + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'test-password' }),
      });
      return r.headers.get('set-cookie').split(';')[0];
    }
    const contributor = await login('contributor@example.com');
    assert.equal((await fetch(base + '/api/storage/migration', { headers: { Cookie: contributor } })).status, 404);
    const response = await fetch(base + '/api/uploads', {
      method: 'POST',
      headers: { Cookie: contributor, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'image/png', size: 8 }),
    });
    assert.equal(response.status, 201);
    const { url, uploadUrl } = await response.json();
    assert.ok(uploadUrl.startsWith('https://test.supabase.co/storage/v1/object/upload/sign/sideproj-media/'));
    assert.ok(url.startsWith('/media/'));
    const redirect = await fetch(base + url, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.ok(
      redirect.headers.get('location').startsWith('https://test.supabase.co/storage/v1/object/public/sideproj-media/')
    );
    await assert.rejects(readFile(path.join(dataDir, 'uploads', url.split('/').pop())));
    const download = await fetch(base + url + '?download=beta.mov', { redirect: 'manual' });
    assert.equal(new URL(download.headers.get('location')).searchParams.get('download'), 'beta.mov');
    const admin = await login('admin@example.com');
    assert.equal((await fetch(base + '/api/storage/migration', { headers: { Cookie: admin } })).status, 404);
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise(r => server.close(r));
    }
    if (!path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'sideproj-storage-'))
      throw new Error('Unsafe cleanup');
    await rm(dataDir, { recursive: true, force: true });
  }
});
