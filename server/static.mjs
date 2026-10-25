import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mediaReference } from './media-reference.mjs';
import { fail } from './http.mjs';

// Content types for the built front end served from dist/.
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

// Serves GET and HEAD requests outside the API: /media/ links, which redirect to Supabase Storage, and the built front
// end from `distDir`. With `live`, index.html reloads the page whenever Vite finishes a rebuild.
export function staticFiles({ distDir, live, storage }) {
  return async function serve({ req, res, url }) {
    // Media is served by Supabase Storage; /media/ URLs redirect there. Uploads never overwrite a file, so a path
    // always names the same file and browsers may cache the redirect instead of asking again on every view.
    if (url.pathname.startsWith('/media/')) {
      const ref = mediaReference(url.pathname);
      if (!ref) throw fail('Invalid media URL.', 404);
      const target = new URL(storage.publicUrl(ref.path));
      if (url.searchParams.has('download'))
        target.searchParams.set('download', url.searchParams.get('download').slice(0, 255));
      res.writeHead(302, { Location: target.href, 'Cache-Control': 'public, max-age=86400' });
      return res.end();
    }
    // Anything else is a file from the built front end; paths that resolve outside dist/ are refused.
    const filename = path.resolve(
      distDir,
      '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    );
    if (!filename.startsWith(path.resolve(distDir) + path.sep)) throw fail('Not found.', 404);
    let bytes;
    try {
      bytes = await readFile(filename);
    } catch (e) {
      if (e.code === 'ENOENT') throw fail('Not found.', 404);
      throw e;
    }
    if (live && filename.endsWith('index.html'))
      bytes = Buffer.from(
        bytes
          .toString()
          .replace('</body>', `<script>new EventSource('/api/events').onmessage=()=>location.reload()</script></body>`)
      );
    // Vite names built files under /assets/ by their contents, so a changed file gets a new URL and browsers can
    // keep these for a year. Other files (index.html, the favicon) keep their names, so are checked each time.
    const hashed = !live && url.pathname.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  };
}
