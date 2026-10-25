import { loadEnv } from 'vite';
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

const fail = (message, status = 503) => Object.assign(new Error(message), { status });
// Session cookies are 32 random bytes, base64url-encoded.
const validToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
// The database stores only a hash of the cookie as the row ID, and the tokens encrypted with a key derived from the
// cookie, so its rows cannot be used to sign in without the cookie itself.
const idOf = token =>
  createHash('sha256')
    .update('sideproj-session-id:' + token)
    .digest('hex');
const keyOf = token => Buffer.from(hkdfSync('sha256', token, '', 'sideproj-session-key', 32));
// What is saved for a session: its Supabase tokens and account, and when its cookie expires.
const stored = ({ accessToken, refreshToken, expires, user, cookieExpires }) => ({
  accessToken,
  refreshToken,
  expires,
  user,
  cookieExpires,
});

function seal(token, session) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(token), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(stored(session))), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

function open(token, payload) {
  const bytes = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', keyOf(token), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
}

// Recently used sessions are kept in memory, so most requests need no database read. Every API request still checks
// the access token with Supabase (auth.resolve), so a session signed out elsewhere stops working straight away.
function createCache(max) {
  const entries = new Map();
  return {
    get(token) {
      const session = entries.get(token);
      if (session && session.cookieExpires <= Date.now()) entries.delete(token);
      else if (session) return session;
    },
    set(token, session) {
      entries.delete(token);
      entries.set(token, session);
      if (entries.size > max) entries.delete(entries.keys().next().value);
    },
    delete(token) {
      entries.delete(token);
    },
    deleteUser(userId) {
      for (const [token, session] of entries) if (session.user?.id === userId) entries.delete(token);
    },
  };
}

/**
 * Signed-in sessions, keyed by the random sideproj_session cookie. They are saved in the database
 * (private.app_sessions), so they survive restarts and can be shared by several servers.
 * Every method is async; `get` returns undefined for an unknown or expired cookie.
 */
export function createSessionStore({
  env = { ...loadEnv('development', process.cwd(), ''), ...process.env },
  fetchImpl = fetch,
  cacheSize = 10000,
} = {}) {
  const base = env.SUPABASE_URL?.replace(/\/$/, '');
  const cache = createCache(cacheSize);
  async function rpc(name, values, accessToken) {
    if (!base || !env.SUPABASE_PUBLISHABLE_KEY) throw fail('Account service is not configured.');
    let response;
    try {
      response = await fetchImpl(base + '/rest/v1/rpc/' + name, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
        },
        body: JSON.stringify(values),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw fail('Account service is unavailable. Please try again.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw fail(
        data?.code === 'PGRST202'
          ? 'Apply the app sessions SQL migration before signing in.'
          : 'Could not load or save your session. Please try again.'
      );
    return data;
  }
  return {
    // `fresh` skips the memory cache, to pick up tokens another server refreshed.
    async get(token, { fresh = false } = {}) {
      if (!validToken(token)) return;
      if (!fresh) {
        const cached = cache.get(token);
        if (cached) return cached;
      }
      const payload = await rpc('read_app_session', { session_id: idOf(token) });
      if (typeof payload !== 'string') return cache.delete(token);
      let session;
      try {
        session = open(token, payload);
      } catch {
        return;
      }
      if (session.cookieExpires <= Date.now()) return;
      // Keep the cached object when there is one, so requests in progress share its refresh.
      const current = cache.get(token);
      if (current) return Object.assign(current, session);
      cache.set(token, session);
      return session;
    },
    // Saves a new session and returns its cookie value.
    async create(session) {
      const token = randomBytes(32).toString('base64url');
      await rpc(
        'create_app_session',
        { session_id: idOf(token), payload: seal(token, session), expires_at: new Date(session.cookieExpires) },
        session.accessToken
      );
      cache.set(token, session);
      return token;
    },
    // Saves a session's refreshed tokens.
    async update(token, session) {
      await rpc('update_app_session', { session_id: idOf(token), payload: seal(token, session) }, session.accessToken);
    },
    async remove(token) {
      if (!validToken(token)) return;
      cache.delete(token);
      await rpc('delete_app_session', { session_id: idOf(token) });
    },
    // The account's database rows go with the account; this drops the ones cached here.
    async removeUser(userId) {
      cache.deleteUser(userId);
    },
  };
}

// The same interface kept only in memory, for tests that run the server without Supabase.
export function createMemorySessionStore() {
  const cache = createCache(Infinity);
  return {
    async get(token) {
      return cache.get(token);
    },
    async create(session) {
      const token = randomBytes(32).toString('base64url');
      cache.set(token, session);
      return token;
    },
    async update() {},
    async remove(token) {
      cache.delete(token);
    },
    async removeUser(userId) {
      cache.deleteUser(userId);
    },
  };
}
