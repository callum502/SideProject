import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGuideServer } from '../server.mjs';

test('guide, uploaded images and all annotation types persist; stale writes and invalid uploads are rejected', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sideproj-test-'));
  let app;
  const start = async () => { app = await createGuideServer({ dataDir }); await new Promise(r => app.server.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${app.server.address().port}`; };
  const stop = async () => { app.server.closeAllConnections(); await new Promise(r => app.server.close(r)); };
  try {
    let base = await start();
    const read = () => fetch(base + '/api/guide').then(r => r.json());
    const put = data => fetch(base + '/api/guide', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const initial = await read(); assert.equal(initial.locations.length, 0);
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
    const upload = await fetch(base + '/api/images', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes });
    assert.equal(upload.status, 201); const { url } = await upload.json();
    const annotations = [{ type: 'line', x: 0, y: 0, x2: 1000, y2: 1000 }, { type: 'box', x: 700, y: 700, x2: 200, y2: 200 }, { type: 'freehand', points: [[0, 0], [500, 300], [1000, 1000]] }];
    const data = { ...initial, locations: [{ id: 'test-location', name: 'Test crag', region: 'Test region', latitude: '0', longitude: '0', approach: 'Walk from the gate.', boulders: [{ id: 'test-boulder', name: 'Test boulder', notes: 'Start on the left.', images: [{ id: 'test-image', name: 'test.png', url, annotations }] }] }] };
    let response = await put(data); assert.equal(response.status, 200); const saved = await response.json();
    assert.equal(saved.revision, 1);
    response = await put(data); assert.equal(response.status, 409, 'stale write must not overwrite data');
    assert.deepEqual(await read(), saved);
    response = await put({ ...saved, locations: [{ ...saved.locations[0], latitude: '91' }] }); assert.equal(response.status, 400);
    response = await fetch(base + '/api/images', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: '<script>bad</script>' }); assert.equal(response.status, 400);
    response = await fetch(base + '/api/guide', { method: 'PUT', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify(saved) }); assert.equal(response.status, 403);
    await stop(); base = await start();
    assert.deepEqual(await read(), saved, 'data survives a server restart');
    response = await fetch(base + url); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(response.headers.get('content-type'), 'image/png');
  } finally {
    if (app?.server.listening) await stop();
    if (!path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'sideproj-test-')) throw new Error('Unsafe test cleanup path');
    await rm(dataDir, { recursive: true, force: true });
  }
});
