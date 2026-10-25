import { createRequestLimits, clientAddress } from './request-limits.mjs';
import { createStorage } from './storage.mjs';
import { createContentStore } from './content-store.mjs';
import { createAuth } from './auth.mjs';
import { createSessionStore } from './session-store.mjs';
import { deploymentConfig } from './deployment.mjs';
import { fail } from './http.mjs';
import { staticFiles } from './static.mjs';
import { authRoutes } from './routes/auth.mjs';
import { profileRoutes } from './routes/profiles.mjs';
import { friendRoutes } from './routes/friends.mjs';
import { guideRoutes } from './routes/guide.mjs';
import { uploadRoutes } from './routes/uploads.mjs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export { fullGuideOption } from './routes/guide.mjs';

// The project folder, which holds the built front end in dist/.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// A route's path is a string, a list of strings, or a pattern whose groups become the handler's `params`.
const match = (pattern, pathname) =>
  pattern instanceof RegExp
    ? pathname.match(pattern)?.slice(1)
    : [].concat(pattern).includes(pathname)
      ? []
      : undefined;

/**
 * The app's HTTP server: the JSON API, Google sign-in, media redirects and the built front end.
 * Every dependency can be replaced, so tests can run it against fakes.
 * With `live`, pages reload whenever Vite finishes a rebuild (see `reload`).
 *
 * Each route (see routes/) has a `method` (or list of methods), a `path`, and a `handle` function given the request
 * context: `req`, `res`, `url`, `params`, `json(status, value)`, `user` (null when signed out), `session`, the
 * session cookie's `token`, `appOrigin` and `cookieValue(name)`. A route's `session` says how much of the session it
 * needs: 'resolve' (the default; checks it with Supabase and sets `user`), 'load' (reads it only) or 'none'.
 */
export async function createGuideServer({
  distDir = path.join(root, 'dist'),
  live = false,
  auth = createAuth(),
  storage = createStorage(),
  contentStore = createContentStore({ storage }),
  deployment = deploymentConfig(),
  requestLimits = createRequestLimits(),
  // Signed-in sessions, keyed by the random sideproj_session cookie. Supabase tokens stay on the server.
  sessions = createSessionStore(),
  // Lets anyone read and save the whole guide at once (GET /api/guide, PUT without a location); see fullGuideOption.
  fullGuide = false,
} = {}) {
  const routes = [
    ...authRoutes({ auth, sessions, deployment }),
    ...profileRoutes({ auth, storage }),
    ...friendRoutes({ auth }),
    ...guideRoutes({ contentStore, fullGuide }),
    ...uploadRoutes({ storage }),
  ];
  const find = (method, pathname) => {
    for (const route of routes) {
      const params = match(route.path, pathname);
      if (params && [].concat(route.method).includes(method)) return { route, params };
    }
  };
  const serveFile = staticFiles({ distDir, live, storage });
  // Open live-reload event streams (dev server only).
  const clients = new Set();

  // Reads the request's session, if any, and with `resolve` checks it with Supabase, refreshing its tokens shortly
  // before they expire, and sets the signed-in `user`.
  async function loadSession(context, resolve) {
    const { req, url, token } = context;
    let session = await sessions.get(token);
    if (!session) return;
    // The account ID comes from our server session, never from request input.
    requestLimits.account(session.user.id, url.pathname, req.method);
    context.session = session;
    if (!resolve) return;
    try {
      // Before refreshing tokens that are about to expire, pick up any another server already refreshed.
      if (session.expires < Date.now() + 30000 && !session.refreshing)
        context.session = session = await sessions.get(token, { fresh: true });
      if (session) {
        const accessToken = session.accessToken;
        context.user = await auth.resolve(session);
        if (session.accessToken !== accessToken) await sessions.update(token, session);
      }
    } catch (error) {
      if (error.status !== 401) throw error;
      await sessions.remove(token);
      context.session = undefined;
    }
  }

  const server = http.createServer(async (req, res) => {
    let releaseRequest;
    const json = (status, value) => {
      if (status >= 400 && !req.complete) res.setHeader('Connection', 'close');
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, 'http://localhost');
      // Render's internal health probes do not need a public Host header.
      if (url.pathname === '/healthz' && ['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        return res.end(req.method === 'HEAD' ? undefined : 'ok');
      }
      if (!deployment.allows(req.headers.host, req.headers.origin)) throw fail('Host or origin not allowed.', 403);
      // API and sign-in callback requests count towards the rate limits in request-limits.mjs; media redirects have
      // their own, larger limit, since one page can show many photos.
      const limited = url.pathname.startsWith('/api/') || url.pathname === '/auth/google/callback';
      if (url.pathname.startsWith('/media/')) requestLimits.media(clientAddress(req, deployment.renderProxy));
      if (limited) {
        requestLimits.before(clientAddress(req, deployment.renderProxy), url.pathname, req.method);
        releaseRequest = requestLimits.enter();
      }
      const cookieValue = name =>
        (req.headers.cookie || '')
          .split(';')
          .map(c => c.trim())
          .find(c => c.startsWith(name + '='))
          ?.slice(name.length + 1);
      const found = find(req.method, url.pathname);
      const context = {
        req,
        res,
        url,
        params: found?.params,
        json,
        user: null,
        session: undefined,
        token: cookieValue('sideproj_session'),
        appOrigin: (deployment.secureCookie ? 'https://' : 'http://') + req.headers.host,
        cookieValue,
      };
      if (found) {
        // Only API requests use the session, so pages and files need no session lookup.
        const mode = found.route.session ?? 'resolve';
        if (mode !== 'none' && url.pathname.startsWith('/api/')) await loadSession(context, mode === 'resolve');
        return await found.route.handle(context);
      }
      if (url.pathname === '/api/events' && live) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw fail('Method not allowed.', 405);
      if (url.pathname.startsWith('/api/')) throw fail('Not found.', 404);
      return await serveFile(context);
    } catch (e) {
      if (e.retryAfter && !res.headersSent) res.setHeader('Retry-After', String(e.retryAfter));
      if (!res.headersSent)
        json(e.status || 500, { error: e.status ? e.message : 'Could not save or load the guide. Please try again.' });
      else res.end();
      if (!e.status && e.name !== 'AbortError' && e.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error(e);
    } finally {
      releaseRequest?.();
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 330000;
  server.keepAliveTimeout = 5000;
  return {
    server,
    reload() {
      for (const client of clients) client.write('data: reload\n\n');
    },
  };
}
