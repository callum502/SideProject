import { createRequestLimits, clientAddress, readRequestBody, testLimitOptions } from './request-limits.mjs';
import { validLocationLinks } from './location-links.mjs';
import { duplicateMediaName } from './media-names.mjs';
import { createStorage } from './storage.mjs';
import { mediaReference } from './media-reference.mjs';
import { matchesType, SIGNATURE_BYTES } from './media-signatures.mjs';
import { createContentStore } from './content-store.mjs';
import { createAuth } from './auth.mjs';
import { createSessionStore } from './session-store.mjs';
import { deploymentConfig } from './deployment.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The file extension each upload type is stored with.
const uploadExtensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};
// Errors carrying a status are sent to the client with their message; any other error becomes a generic 500.
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
// A string of at most `max` characters; when required, it must not be blank.
const text = (value, max, required = false) =>
  typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);

// Marks drawn on a photo. Coordinates are on a 0–1000 scale across the photo's width and height.
function validateAnnotations(annotations) {
  if (!Array.isArray(annotations) || annotations.length > 1000) throw fail('Invalid annotations.');
  const coord = n => Number.isFinite(n) && n >= 0 && n <= 1000;
  for (const a of annotations) {
    if (!a || typeof a !== 'object') throw fail('Invalid annotation.');
    if (!['box', 'line', 'freehand', 'arrow'].includes(a.type)) throw fail('Unknown annotation tool.');
    if (a.color !== undefined && !['green', 'red'].includes(a.color)) throw fail('Unknown annotation colour.');
    if (a.type === 'freehand') {
      if (
        !Array.isArray(a.points) ||
        a.points.length > 20000 ||
        !a.points.every(p => Array.isArray(p) && p.length === 2 && p.every(coord))
      )
        throw fail('Invalid freehand annotation.');
    } else if (![a.x, a.y, a.x2, a.y2].every(coord)) throw fail('Invalid annotation coordinates.');
  }
}

// A problem's annotations must be for photos on its boulder. Only keys a save adds are refused: older data may still
// hold annotations for since-removed photos, and refusing those would block every save to the guide.
function validateAnnotationTargets(data, previous) {
  const oldKeys = new Map();
  for (const location of previous.locations)
    for (const boulder of location.boulders)
      for (const problem of boulder.problems || [])
        oldKeys.set(problem.id, new Set(Object.keys(problem.photoAnnotations || {})));
  for (const location of data.locations)
    for (const boulder of location.boulders) {
      const photos = new Set(boulder.images.map(image => image.id));
      for (const problem of boulder.problems || []) {
        for (const id of Object.keys(problem.photoAnnotations || {}))
          if (!photos.has(id) && !oldKeys.get(problem.id)?.has(id))
            throw fail('Problem annotations must be for photos on this boulder.');
      }
    }
}

// Length limits for names and notes. Text saved before a limit was introduced can stay as it is,
// so only a field that is new or changed is checked.
function validateContentLengths(data, previous) {
  const oldRecords = new Map();
  for (const location of previous.locations) {
    oldRecords.set(location.id, location);
    for (const boulder of location.boulders) {
      oldRecords.set(boulder.id, boulder);
      for (const problem of boulder.problems || []) oldRecords.set(problem.id, problem);
    }
  }
  const check = (record, field, limit, label) => {
    if (
      typeof record[field] === 'string' &&
      record[field].length > limit &&
      record[field] !== oldRecords.get(record.id)?.[field]
    )
      throw fail(label + ' must be no more than ' + limit + ' characters.');
  };
  for (const location of data.locations) {
    check(location, 'name', 80, 'Location name');
    for (const boulder of location.boulders) {
      check(boulder, 'name', 80, 'Boulder name');
      check(boulder, 'notes', 800, 'Finding the Boulder');
      check(boulder, 'otherNotes', 800, 'Other Notes');
      for (const problem of boulder.problems || []) {
        check(problem, 'name', 80, 'Problem name');
        check(problem, 'description', 800, 'Problem description');
      }
    }
  }
}

// Structure and size checks for the whole guide: unique record IDs, required fields, coordinates in range, media
// that points at our storage, unique media names, and problem attachments that belong to the problem's boulder.
function validate(data) {
  if (!Array.isArray(data.locations) || data.locations.length > 1000) throw fail('Invalid guide.');
  const ids = new Set();
  const id = value => {
    if (!text(value, 100, true) || ids.has(value)) throw fail('Invalid or duplicate record ID.');
    ids.add(value);
  };
  for (const l of data.locations) {
    id(l.id);
    if (!validLocationLinks(l.links || [])) throw fail('Links need a label and a valid HTTP or HTTPS URL.');
    if (!text(l.name, 120, true) || !text(l.approach, 10000) || !Array.isArray(l.boulders) || l.boulders.length > 1000)
      throw fail('Invalid location.');
    if (!text(l.latitude, 32) || !text(l.longitude, 32) || !!l.latitude !== !!l.longitude)
      throw fail('Provide both coordinates.');
    if (
      l.latitude &&
      (!Number.isFinite(+l.latitude) ||
        Math.abs(+l.latitude) > 90 ||
        !Number.isFinite(+l.longitude) ||
        Math.abs(+l.longitude) > 180)
    )
      throw fail('Coordinates are outside the valid range.');
    if (l.photos !== undefined && (!Array.isArray(l.photos) || l.photos.length > 200))
      throw fail('Invalid location photos.');
    for (const photo of l.photos || []) {
      id(photo.id);
      if (
        !text(photo.name, 255, true) ||
        !text(photo.caption || '', 2000) ||
        !mediaReference(photo.url) ||
        !/\.(png|jpg|webp)$/.test(photo.url)
      )
        throw fail('Invalid location photo.');
    }
    if (
      duplicateMediaName(
        [],
        (l.photos || []).map(p => p.name)
      ) !== null
    )
      throw fail('Photo names must be unique within this location.');
    for (const b of l.boulders) {
      id(b.id);
      if (
        !text(b.name, 120, true) ||
        !text(b.notes, 10000) ||
        (b.otherNotes !== undefined && !text(b.otherNotes, 10000)) ||
        !Array.isArray(b.images) ||
        b.images.length > 200
      )
        throw fail('Invalid boulder.');
      if (b.videos !== undefined && (!Array.isArray(b.videos) || b.videos.length > 200)) throw fail('Invalid videos.');
      if (b.problems !== undefined && (!Array.isArray(b.problems) || b.problems.length > 1000))
        throw fail('Invalid problems.');
      for (const [kind, media] of [
        ['photo', b.images],
        ['video', b.videos || []],
      ]) {
        if (media.some(item => !item || !text(item.name, 255, true))) throw fail('Enter a valid media name.');
        const duplicate = duplicateMediaName(
          [],
          media.map(item => item.name)
        );
        if (duplicate !== null)
          throw fail(`A ${kind} named "${duplicate}" already exists on this boulder. Choose a different name.`);
      }
      for (const problem of b.problems || []) {
        id(problem.id);
        if (!text(problem.name, 120, true) || !text(problem.grade, 40, true) || !text(problem.description, 10000, true))
          throw fail('A problem needs a name, grade, and description.');
        if (problem.photoAnnotations !== undefined) {
          if (
            !problem.photoAnnotations ||
            typeof problem.photoAnnotations !== 'object' ||
            Array.isArray(problem.photoAnnotations) ||
            Object.keys(problem.photoAnnotations).length > 200
          )
            throw fail('Invalid problem annotations.');
          for (const [imageId, annotations] of Object.entries(problem.photoAnnotations)) {
            validateAnnotations(annotations);
          }
        }
        for (const [field, media] of [
          ['imageIds', b.images],
          ['videoIds', b.videos || []],
        ]) {
          if (
            !Array.isArray(problem[field]) ||
            problem[field].length > 200 ||
            new Set(problem[field]).size !== problem[field].length ||
            !problem[field].every(id => media.some(item => item.id === id))
          )
            throw fail('Problem attachments must belong to this boulder.');
        }
      }
      for (const video of b.videos || []) {
        id(video.id);
        if (!text(video.name, 255, true) || !mediaReference(video.url) || !/\.(mp4|webm|mov)$/.test(video.url))
          throw fail('Invalid video.');
      }
      for (const image of b.images) {
        id(image.id);
        if (
          !text(image.name, 255, true) ||
          !mediaReference(image.url) ||
          !/\.(png|jpg|webp)$/.test(image.url) ||
          !Array.isArray(image.annotations) ||
          image.annotations.length > 1000 ||
          (image.onBoulderPage !== undefined && typeof image.onBoulderPage !== 'boolean')
        )
          throw fail('Invalid image.');
        validateAnnotations(image.annotations);
      }
    }
  }
}

const body = readRequestBody;
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

/**
 * The app's HTTP server: the JSON API, Google sign-in, media redirects and the built front end.
 * Every dependency can be replaced, so tests can run it against fakes.
 * With `live`, pages reload whenever Vite finishes a rebuild (see `reload`).
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
} = {}) {
  // Google sign-ins in progress (PKCE verifier and origin), keyed by the sideproj_oauth cookie.
  const oauthAttempts = new Map();
  // Open live-reload event streams (dev server only).
  const clients = new Set();
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
      const appOrigin = (deployment.secureCookie ? 'https://' : 'http://') + req.headers.host;
      const oauthCookie = 'sideproj_oauth';
      const cookieValue = name =>
        (req.headers.cookie || '')
          .split(';')
          .map(c => c.trim())
          .find(c => c.startsWith(name + '='))
          ?.slice(name.length + 1);
      if (url.pathname === '/api/auth/google' && req.method === 'POST') {
        if (req.headers.origin !== appOrigin) throw fail('Start Google sign-in from this site.', 403);
        for (const [id, attempt] of oauthAttempts) if (attempt.expires < Date.now()) oauthAttempts.delete(id);
        if (oauthAttempts.size >= 1000) throw fail('Please try again later.', 429);
        const verifier = randomBytes(32).toString('base64url'),
          attemptId = randomBytes(32).toString('base64url');
        const target = auth.googleUrl(
          appOrigin + '/auth/google/callback',
          createHash('sha256').update(verifier).digest('base64url')
        );
        const previous = cookieValue(oauthCookie);
        if (previous) oauthAttempts.delete(previous);
        oauthAttempts.set(attemptId, { verifier, origin: appOrigin, expires: Date.now() + 600000 });
        res.setHeader(
          'Set-Cookie',
          oauthCookie + '=' + attemptId + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=600' + deployment.secureCookie
        );
        return json(200, { url: target });
      }
      if (url.pathname === '/auth/google/callback' && req.method === 'GET') {
        const id = cookieValue(oauthCookie),
          attempt = oauthAttempts.get(id);
        oauthAttempts.delete(id);
        const cleared = oauthCookie + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' + deployment.secureCookie;
        res.setHeader('Set-Cookie', cleared);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        try {
          const code = url.searchParams.get('code');
          if (
            !attempt ||
            attempt.expires < Date.now() ||
            attempt.origin !== appOrigin ||
            !code ||
            code.length > 4096 ||
            url.searchParams.has('error')
          )
            throw fail('Google sign-in expired or was cancelled.', 401);
          const nextSession = await auth.exchangeGoogle(code, attempt.verifier);
          const previous = cookieValue('sideproj_session');
          if (previous) await sessions.remove(previous);
          const nextToken = await sessions.create({ ...nextSession, cookieExpires: Date.now() + 86400000 });
          res.setHeader('Set-Cookie', [
            cleared,
            'sideproj_session=' +
              nextToken +
              '; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400' +
              deployment.secureCookie,
          ]);
          res.writeHead(303, { Location: '/#explore' });
          return res.end();
        } catch {
          res.writeHead(303, { Location: '/?google_error=1#login' });
          return res.end();
        }
      }
      const token = cookieValue('sideproj_session');
      // Only API requests use the session, so pages and files need no session lookup.
      let session = url.pathname.startsWith('/api/') ? await sessions.get(token) : undefined;
      let user = null;
      // The account ID comes from our server session, never from request input.
      if (session) requestLimits.account(session.user.id, url.pathname, req.method);
      if (session && url.pathname !== '/api/logout') {
        try {
          // Before refreshing tokens that are about to expire, pick up any another server already refreshed.
          if (session.expires < Date.now() + 30000 && !session.refreshing)
            session = await sessions.get(token, { fresh: true });
          if (session) {
            const accessToken = session.accessToken;
            user = await auth.resolve(session);
            if (session.accessToken !== accessToken) await sessions.update(token, session);
          }
        } catch (error) {
          if (error.status !== 401) throw error;
          await sessions.remove(token);
          session = undefined;
        }
      }
      if (url.pathname === '/api/account' && req.method === 'DELETE') {
        if (!user) throw fail('Log in first.', 401);
        if (req.headers.origin !== appOrigin) throw fail('Delete your account from this site.', 403);
        let values;
        try {
          values = JSON.parse((await body(req, 1024)).toString());
        } catch {
          throw fail('Confirm account deletion.');
        }
        if (values?.confirmation !== 'DELETE') throw fail('Type DELETE to confirm.');
        await auth.deleteAccount(session);
        // The account's saved sessions are deleted with it; this drops the ones cached by this server.
        await sessions.removeUser(user.id);
        res.setHeader(
          'Set-Cookie',
          'sideproj_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' + deployment.secureCookie
        );
        return json(200, { deleted: true });
      }
      if (url.pathname === '/api/storage/usage' && req.method === 'GET') {
        if (!user) throw fail('Log in first.', 401);
        return json(200, await storage.usage(session.accessToken));
      }
      if (url.pathname === '/api/profile-photo' && req.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw fail('Invalid profile.', 400);
        const path = await auth.profilePhoto(id);
        if (!path) return json(404, { error: 'No profile photo.' });
        res.writeHead(302, { Location: storage.publicUrl(path), 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (url.pathname === '/api/profile-photo' && req.method === 'POST') {
        if (!user) throw fail('Log in first.', 401);
        let values;
        try {
          values = JSON.parse((await body(req, 2048)).toString());
        } catch {
          throw fail('Invalid photo.');
        }
        const ref = typeof values?.url === 'string' ? mediaReference(values.url) : null;
        if (values?.url !== null && (!ref || !/\.(jpg|png|webp)$/.test(ref.path) || ref.path.split('/')[0] !== user.id))
          throw fail('Choose an image uploaded by your account.', 400);
        // The browser uploaded the file straight to Storage, so check here that it really is an image.
        if (ref) {
          const info = await storage.inspect(ref.path, session.accessToken, SIGNATURE_BYTES);
          const expected = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ref.path.split('.').pop()];
          if (info.mime !== expected || !matchesType(expected, info.bytes))
            throw fail('The file is not a supported image.');
          if (info.size > 8 * 1024 * 1024) throw fail('File is too large (8 MB maximum).', 413);
        }
        const previous = await auth.profilePhoto(user.id).catch(() => null);
        await auth.setProfilePhoto(ref?.path || null, session);
        // A replaced or removed photo's file would otherwise stay stored, using the allowance. Storage keeps it if
        // something still uses it (such as a guide photo). The change is saved either way; a failure is only logged.
        if (previous && previous !== ref?.path)
          await storage
            .remove([previous], session.accessToken)
            .catch(error => console.error('Could not delete the previous profile photo:', error.message));
        return json(200, { saved: true });
      }
      if (url.pathname === '/api/public-profile' && req.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id || !uuidPattern.test(id)) throw fail('Profile not found.', 404);
        const profile = await auth.publicProfile(id);
        if (!profile) throw fail('Profile not found.', 404);
        return json(200, { ...profile, hasPhoto: !!(await auth.profilePhoto(id)) });
      }
      if (url.pathname === '/api/friends' && req.method === 'POST') {
        if (!user) throw fail('Log in to use Friends.', 401);
        let values;
        try {
          values = JSON.parse((await body(req, 2048)).toString());
        } catch {
          throw fail('Invalid friend request.');
        }
        if (
          !values ||
          !['list', 'search', 'suggest', 'request', 'accept', 'decline', 'remove', 'logbook'].includes(values.action)
        )
          throw fail('Invalid friend action.');
        if (
          ['search', 'suggest'].includes(values.action) &&
          (typeof values.name !== 'string' || !values.name.trim() || values.name.length > 120)
        )
          throw fail('Enter a display name.');
        if (
          !['list', 'search', 'suggest'].includes(values.action) &&
          (typeof values.target !== 'string' || !uuidPattern.test(values.target))
        )
          throw fail('Choose a valid account.');
        try {
          return json(200, await auth.friends(session, values));
        } catch (e) {
          // Refusals (inviting yourself, the invite limit, a non-friend's logbook, an expired session)
          // keep their own message.
          if (e.status >= 400 && e.status < 500) throw e;
          throw fail('Could not update Friends. Please try again in a moment.', 503);
        }
      }
      if (url.pathname === '/api/logbook' && ['GET', 'POST'].includes(req.method)) {
        if (!user) throw fail('Log in to use your logbook.', 401);
        let values;
        if (req.method === 'POST') {
          try {
            values = JSON.parse((await body(req, 1024)).toString());
          } catch {
            throw fail('Invalid log entry.');
          }
          if (
            !values ||
            typeof values.completed !== 'boolean' ||
            typeof values.problemId !== 'string' ||
            !uuidPattern.test(values.problemId)
          )
            throw fail('Invalid log entry.');
        }
        try {
          return json(200, await auth.logbook(session, values));
        } catch (e) {
          // Errors meant for the user (a removed problem, an expired session) keep their own message.
          if (e.status >= 400 && e.status < 500) throw e;
          throw fail(
            'Could not load or save your logbook. Check your connection and that the logbook SQL migration has been applied.',
            503
          );
        }
      }
      if (url.pathname === '/api/profile' && req.method === 'POST') {
        if (!user) throw fail('Log in first.', 401);
        let values;
        try {
          values = JSON.parse((await body(req, 4096)).toString());
        } catch {
          throw fail('Invalid profile details.');
        }
        if (!values || typeof values !== 'object') throw fail('Invalid profile details.');
        const updated = await auth.completeProfile(values, session);
        session.user = updated;
        return json(200, { user: updated });
      }
      if (url.pathname === '/api/session' && req.method === 'GET') return json(200, { user });
      if (
        ['/api/login', '/api/signup', '/api/confirm', '/api/recover', '/api/reset-password'].includes(url.pathname) &&
        req.method === 'POST'
      ) {
        let values;
        try {
          values = JSON.parse((await body(req, 4096)).toString());
        } catch {
          throw fail('Enter valid account details.');
        }
        if (!values || typeof values !== 'object') throw fail('Enter valid account details.');
        if (url.pathname !== '/api/login') {
          const action = {
            '/api/confirm': 'confirm',
            '/api/signup': 'signup',
            '/api/recover': 'recover',
            '/api/reset-password': 'reset',
          }[url.pathname];
          return json(200, await auth[action](values));
        }
        const nextSession = await auth.login(values);
        const identity = nextSession.user;
        if (token) await sessions.remove(token);
        const nextToken = await sessions.create({ ...nextSession, cookieExpires: Date.now() + 86400000 });
        res.setHeader(
          'Set-Cookie',
          'sideproj_session=' +
            nextToken +
            '; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400' +
            deployment.secureCookie
        );
        return json(200, { user: identity });
      }
      if (url.pathname === '/api/logout' && req.method === 'POST') {
        // The cookie is cleared even if the saved session can't be deleted right now; Supabase's own logout below
        // still revokes its tokens, so it can't be used again.
        await sessions
          .remove(token)
          .catch(error => console.error('Could not delete the saved session:', error.message));
        res.setHeader(
          'Set-Cookie',
          'sideproj_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' + deployment.secureCookie
        );
        // The local session is invalidated even if Supabase is temporarily unavailable.
        await auth.logout(session).catch(() => {});
        return json(200, { user: null });
      }
      if (
        user?.profileComplete === false &&
        ['/api/guide', '/api/uploads'].includes(url.pathname) &&
        ['PUT', 'POST', 'DELETE'].includes(req.method)
      )
        throw fail('Complete your profile before contributing.', 403);
      if (
        ['/api/guide', '/api/uploads'].includes(url.pathname) &&
        ['PUT', 'POST', 'DELETE'].includes(req.method) &&
        !user
      )
        throw fail('Log in to contribute.', 401);
      const readToken = user ? session.accessToken : undefined;
      if (url.pathname === '/api/guide' && req.method === 'GET') return json(200, await contentStore.read(readToken));
      // The app loads the list of locations for search and the map, then each location as it is opened.
      if (url.pathname === '/api/locations' && req.method === 'GET')
        return json(200, await contentStore.summaries(readToken));
      if (url.pathname.startsWith('/api/locations/') && req.method === 'GET') {
        const id = url.pathname.slice('/api/locations/'.length);
        const guide = uuidPattern.test(id) ? await contentStore.readLocation(id, readToken) : { locations: [] };
        if (!guide.locations.length) throw fail('Location not found.', 404);
        return json(200, guide);
      }
      if (url.pathname === '/api/guide' && req.method === 'PUT') {
        let data;
        try {
          data = JSON.parse((await body(req, 12 * 1024 * 1024)).toString());
        } catch (e) {
          if (e.status) throw e;
          throw fail('Invalid JSON.');
        }
        if (!data || !Array.isArray(data.changes)) throw fail('Invalid changes.');
        // `location` limits the save to one location, and the reply to that location (none once it is removed).
        if (data.location !== undefined && !(typeof data.location === 'string' && uuidPattern.test(data.location)))
          throw fail('Invalid location.');
        // Changes are applied to the latest guide; the merged result must pass the same checks as a full guide.
        return json(
          200,
          await contentStore.save(
            data.changes,
            user,
            session.accessToken,
            (next, current) => {
              validate(next);
              validateContentLengths(next, current);
              validateAnnotationTargets(next, current);
            },
            data.location
          )
        );
      }
      // Starts an upload: the browser then sends the file straight to Storage at the returned uploadUrl, so its bytes
      // never pass through this server. Its contents are checked when a save first uses it (content-store.mjs).
      if (url.pathname === '/api/uploads' && req.method === 'POST') {
        let values;
        try {
          values = JSON.parse((await body(req, 1024)).toString());
        } catch {
          throw fail('Invalid upload.');
        }
        const extension = uploadExtensions[values?.type];
        if (!extension)
          throw fail(
            String(values?.type).startsWith('video/')
              ? 'Choose MP4, WebM, or MOV videos.'
              : 'Choose JPEG, PNG, or WebP images.'
          );
        if (!Number.isSafeInteger(values.size) || values.size <= 0) throw fail('Invalid upload.');
        const filename = `${randomUUID()}.${extension}`;
        return json(
          201,
          await storage.signUpload(user.id + '/' + filename, values.size, values.type, session.accessToken)
        );
      }
      // Delete the user's own uploads from a batch that didn't save, so they don't use up the storage allowance.
      // Storage only deletes files nothing uses (sideproj_remove_unused), so a file already in the guide is kept.
      if (url.pathname === '/api/uploads/discard' && req.method === 'POST') {
        if (!user) throw fail('Log in first.', 401);
        let values;
        try {
          values = JSON.parse((await body(req, 16384)).toString());
        } catch {
          throw fail('Invalid uploads.');
        }
        const urls = values?.urls;
        if (!Array.isArray(urls) || !urls.length || urls.length > 50) throw fail('Invalid uploads.');
        const paths = urls.map(u => (typeof u === 'string' ? mediaReference(u)?.path : null));
        if (paths.some(p => !p || p.split('/')[0] !== user.id))
          throw fail('You can only discard your own uploads.', 403);
        return json(200, { removed: await storage.remove(paths, session.accessToken) });
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
            .replace(
              '</body>',
              `<script>new EventSource('/api/events').onmessage=()=>location.reload()</script></body>`
            )
        );
      res.writeHead(200, {
        'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
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

// Run directly: `npm run dev` rebuilds on change with live reload; `npm run preview` (--preview) serves the build.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const live = !process.argv.includes('--preview');
  const deployment = deploymentConfig();
  const env = { ...(await import('vite')).loadEnv('development', process.cwd(), ''), ...process.env };
  const app = await createGuideServer({ live, deployment, requestLimits: createRequestLimits(testLimitOptions(env)) });
  if (live) {
    const { build } = await import('vite');
    const watcher = await build({ root, resolve: { preserveSymlinks: true }, build: { watch: {}, minify: false } });
    await new Promise((resolve, reject) => {
      watcher.on('event', event => {
        if (event.code === 'END') {
          app.reload();
          resolve();
        }
        if (event.code === 'ERROR') {
          console.error(event.error);
          reject(event.error);
        }
      });
    });
  }
  const port = Number(process.env.PORT || 5173);
  app.server.listen(port, deployment.host, () => console.log(`SideProj running at http://${deployment.host}:${port}/`));
}
