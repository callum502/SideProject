import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportGuide } from '../src/exportGuide.js';

test('shared guide embeds photos and annotation geometry and escapes user text', async t => {
  let output, clicked = false;
  t.mock.method(URL, 'createObjectURL', blob => { output = blob; return 'blob:test'; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } }));
  const oldReader = globalThis.FileReader, oldWindow = globalThis.window;
  globalThis.FileReader = class { async readAsDataURL(blob) { this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onload(); } };
  globalThis.window = { document: { createElement: () => ({ click() { clicked = true; } }) } };
  try {
    await exportGuide({ name: '<script>alert(1)</script>', region: 'A & B', latitude: '0', longitude: '0', approach: 'Left < right', boulders: [{ name: 'Boulder', notes: 'Route notes', images: [{ name: 'photo.png', url: '/uploads/test.png', annotations: [{ type: 'line', x: 10, y: 20, x2: 30, y2: 40 }, { type: 'box', x: 80, y: 80, x2: 20, y2: 30 }, { type: 'freehand', points: [[10, 20], [30, 40]] }] }] }] });
    const html = await output.text();
    assert.ok(clicked);
    assert.ok(html.includes('data:image/png;base64,'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('<rect x="20" y="30" width="60" height="50"/>'));
    assert.ok(html.includes('<line x1="10" y1="20" x2="30" y2="40"/>'));
    assert.ok(html.includes('<polyline points="10,20 30,40"/>'));
  } finally { globalThis.FileReader = oldReader; globalThis.window = oldWindow; }
});
