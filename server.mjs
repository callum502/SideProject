import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, max, required = false) => typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);
function validate(data) {
  if (!Number.isSafeInteger(data.revision) || !Array.isArray(data.locations) || data.locations.length > 1000) throw fail('Invalid guide.');
  const ids = new Set();
  const id = value => { if (!text(value, 100, true) || ids.has(value)) throw fail('Invalid or duplicate record ID.'); ids.add(value); };
  for (const l of data.locations) {
    id(l.id);
    if (!text(l.name, 120, true) || !text(l.region, 120) || !text(l.approach, 10000) || !Array.isArray(l.boulders) || l.boulders.length > 1000) throw fail('Invalid location.');
    if (typeof l.latitude !== 'string' || typeof l.longitude !== 'string' || !!l.latitude !== !!l.longitude) throw fail('Provide both coordinates.');
    if (l.latitude && (!Number.isFinite(+l.latitude) || Math.abs(+l.latitude) > 90 || !Number.isFinite(+l.longitude) || Math.abs(+l.longitude) > 180)) throw fail('Coordinates are outside the valid range.');
    for (const b of l.boulders) {
      id(b.id);
      if (!text(b.name, 120, true) || !text(b.notes, 10000) || !Array.isArray(b.images) || b.images.length > 200) throw fail('Invalid boulder.');
      if (b.videos !== undefined && (!Array.isArray(b.videos) || b.videos.length > 200)) throw fail('Invalid videos.');
      for (const video of b.videos || []) {
        id(video.id);
        if (!text(video.name, 255, true) || !/^\/uploads\/[a-f0-9-]+\.(mp4|webm)$/.test(video.url)) throw fail('Invalid video.');
      }
      for (const image of b.images) {
        id(image.id);
        if (!text(image.name, 255, true) || !/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(image.url) || !Array.isArray(image.annotations) || image.annotations.length > 1000) throw fail('Invalid image.');
        const coord = n => Number.isFinite(n) && n >= 0 && n <= 1000;
        for (const a of image.annotations) {
          if (!['box', 'line', 'freehand'].includes(a.type)) throw fail('Unknown annotation tool.');
          if (a.type === 'freehand') {
            if (!Array.isArray(a.points) || a.points.length > 20000 || !a.points.every(p => Array.isArray(p) && p.length === 2 && p.every(coord))) throw fail('Invalid freehand annotation.');
          } else if (![a.x, a.y, a.x2, a.y2].every(coord)) throw fail('Invalid annotation coordinates.');
        }
      }
    }
  }
}
async function body(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail('Upload is too large.', 413); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
export async function createGuideServer({ dataDir = path.join(root, 'data'), distDir = path.join(root, 'dist'), live = false } = {}) {
  await mkdir(path.join(dataDir, 'uploads'), { recursive: true });
  const guidePath = path.join(dataDir, 'guide.json');
  try { await stat(guidePath); } catch (e) { if (e.code !== 'ENOENT') throw e; await writeFile(guidePath, JSON.stringify({ revision: 0, locations: [] })); }
  let queue = Promise.resolve();
  const clients = new Set();
  const server = http.createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    try {
      // This local prototype accepts same-origin writes only and binds to loopback.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw fail('Cross-origin requests are not allowed.', 403);
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) throw fail('Host not allowed.', 403);
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/guide' && req.method === 'GET') return json(200, JSON.parse(await readFile(guidePath, 'utf8')));
      if (url.pathname === '/api/guide' && req.method === 'PUT') {
        let data; try { data = JSON.parse((await body(req, 12 * 1024 * 1024)).toString()); } catch (e) { if (e.status) throw e; throw fail('Invalid JSON.'); }
        validate(data);
        const task = queue.then(async () => {
          const current = JSON.parse(await readFile(guidePath, 'utf8'));
          if (data.revision !== current.revision) throw fail('This guide changed in another tab. Reload the page before saving again.', 409);
          for (const l of data.locations) for (const b of l.boulders) for (const image of [...b.images, ...(b.videos || [])]) {
            try { await stat(path.join(dataDir, image.url)); } catch { throw fail('An uploaded file is missing. Please upload it again.'); }
          }
          const next = { revision: current.revision + 1, locations: data.locations };
          await writeFile(`${guidePath}.tmp`, JSON.stringify(next, null, 2));
          await rename(`${guidePath}.tmp`, guidePath);
          return next;
        });
        queue = task.catch(() => {});
        return json(200, await task);
      }
      if (url.pathname === '/api/images' && req.method === 'POST') {
        const mime = req.headers['content-type'];
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw fail('Choose JPEG, PNG, or WebP images.');
        const bytes = await body(req, 8 * 1024 * 1024);
        const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
        if (!(mime === 'image/png' && png || mime === 'image/jpeg' && jpg || mime === 'image/webp' && webp)) throw fail('The file is not a supported image.');
        const filename = `${randomUUID()}.${png ? 'png' : jpg ? 'jpg' : 'webp'}`;
        await writeFile(path.join(dataDir, 'uploads', filename), bytes);
        return json(201, { url: `/uploads/${filename}` });
      }
      if (url.pathname === '/api/videos' && req.method === 'POST') {
        const mime = req.headers['content-type'];
        if (!['video/mp4', 'video/webm'].includes(mime)) throw fail('Choose MP4 or WebM videos.');
        if (Number(req.headers['content-length']) > 100 * 1024 * 1024) throw fail('Each video must be smaller than 100 MB.', 413);
        const bytes = await body(req, 100 * 1024 * 1024);
        const mp4 = bytes.length >= 16 && bytes.toString('ascii', 4, 8) === 'ftyp';
        const webm = bytes.length >= 16 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && bytes.subarray(0, 4096).includes(Buffer.from('webm'));
        if (!(mime === 'video/mp4' && mp4 || mime === 'video/webm' && webm)) throw fail('The file is not a supported video.');
        const filename = `${randomUUID()}.${mime === 'video/mp4' ? 'mp4' : 'webm'}`;
        await writeFile(path.join(dataDir, 'uploads', filename), bytes);
        return json(201, { url: `/uploads/${filename}` });
      }
      if (url.pathname === '/api/events' && live) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.write(': connected\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw fail('Method not allowed.', 405);
      if (url.pathname.startsWith('/api/')) throw fail('Not found.', 404);
      const upload = url.pathname.startsWith('/uploads/');
      if (upload && !/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp|mp4|webm)$/.test(url.pathname)) throw fail('Not found.', 404);
      const base = upload ? dataDir : distDir;
      const filename = path.resolve(base, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!filename.startsWith(path.resolve(base) + path.sep)) throw fail('Not found.', 404);
      if (upload && /\.(mp4|webm)$/.test(filename)) {
        let info; try { info = await stat(filename); } catch { throw fail('Not found.', 404); }
        let start = 0, end = info.size - 1, status = 200;
        const headers = { 'Content-Type': filename.endsWith('.mp4') ? 'video/mp4' : 'video/webm', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
        if (req.headers.range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
          if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; }
          else { start = Math.max(0, info.size - Number(match[2])); }
          if (start > end || start >= info.size || (!match[1] && Number(match[2]) === 0)) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); }
          status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
        }
        headers['Content-Length'] = end - start + 1;
        res.writeHead(status, headers);
        if (req.method === 'HEAD') return res.end();
        const stream = createReadStream(filename, { start, end });
        stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); return;
      }
      let bytes; try { bytes = await readFile(filename); } catch (e) { if (e.code === 'ENOENT') throw fail('Not found.', 404); throw e; }
      if (live && filename.endsWith('index.html')) bytes = Buffer.from(bytes.toString().replace('</body>', `<script>new EventSource('/api/events').onmessage=()=>location.reload()</script></body>`));
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': upload ? 'public, max-age=31536000, immutable' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (e) { if (!res.headersSent) json(e.status || 500, { error: e.status ? e.message : 'Could not save or load the guide. Please try again.' }); else res.end(); if (!e.status) console.error(e); }
  });
  return { server, reload() { for (const client of clients) client.write('data: reload\n\n'); } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const live = !process.argv.includes('--preview');
  const app = await createGuideServer({ live });
  if (live) {
    const { build } = await import('vite');
    const watcher = await build({ root, resolve: { preserveSymlinks: true }, build: { watch: {}, minify: false } });
    await new Promise((resolve, reject) => { watcher.on('event', event => { if (event.code === 'END') { app.reload(); resolve(); } if (event.code === 'ERROR') { console.error(event.error); reject(event.error); } }); });
  }
  const port = Number(process.env.PORT || 5173);
  app.server.listen(port, '127.0.0.1', () => console.log(`SideProj running at http://127.0.0.1:${port}/`));
}
