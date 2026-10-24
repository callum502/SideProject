import { isIP } from 'node:net';

const reject = (message, status = 429, retryAfter = 60) => Object.assign(new Error(message), { status, retryAfter });
export const REQUEST_LIMITS = {
  ip: { count: 300, window: 60000 },
  account: { count: 240, window: 60000 },
  auth: { count: 20, window: 600000 },
  write: { count: 60, window: 60000 },
  upload: { count: 20, window: 60000 },
};
const authPaths = new Set([
  '/api/login',
  '/api/signup',
  '/api/confirm',
  '/api/recover',
  '/api/reset-password',
  '/api/auth/google',
  '/auth/google/callback',
]);
export const isUpload = (path, method) => method === 'POST' && ['/api/images', '/api/videos'].includes(path);

export function clientAddress(req, renderProxy = false) {
  // Render sets the first X-Forwarded-For entry to the client address. Trust
  // this contract only on Render; local/other hosting ignores supplied headers.
  let address = renderProxy ? req.headers['x-forwarded-for']?.split(',')[0]?.trim() : null;
  if (!isIP(address || '')) address = req.socket.remoteAddress || 'unknown';
  if (address.startsWith('::ffff:') && isIP(address.slice(7)) === 4) return address.slice(7);
  if (isIP(address) === 6) {
    const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const [left, right] = canonical.split('::');
    const a = left ? left.split(':') : [],
      b = right ? right.split(':') : [];
    const groups = right === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
    return (
      groups
        .slice(0, 4)
        .map(v => v.padStart(4, '0'))
        .join(':') + '::/64'
    );
  }
  return address;
}

// Browser tests send every worker's traffic from 127.0.0.1, so E2E_RELAX_LIMITS=1 raises the limits 100-fold
// for Playwright's own server. Allowed only outside production and against local Supabase;
// any other setup refuses to start.
export function testLimitOptions(env) {
  if (env.E2E_RELAX_LIMITS !== '1') return {};
  if (env.NODE_ENV === 'production' || env.RENDER === 'true')
    throw new Error('E2E_RELAX_LIMITS must not be set in production.');
  let host;
  try {
    host = new URL(env.SUPABASE_URL).hostname;
  } catch {}
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host))
    throw new Error('E2E_RELAX_LIMITS requires SUPABASE_URL to point to local Supabase.');
  return {
    rules: Object.fromEntries(
      Object.entries(REQUEST_LIMITS).map(([kind, rule]) => [kind, { ...rule, count: rule.count * 100 }])
    ),
    maxUploads: 8,
  };
}

export function createRequestLimits({
  now = Date.now,
  rules = REQUEST_LIMITS,
  maxKeys = 10000,
  maxActive = 32,
  maxUploads = 2,
} = {}) {
  const buckets = new Map(),
    uploads = new Set();
  let active = 0,
    swept = 0;
  function take(kind, key) {
    const time = now(),
      rule = rules[kind],
      name = kind + ':' + key;
    if (time - swept >= 60000) {
      for (const [k, v] of buckets) if (v.until <= time) buckets.delete(k);
      swept = time;
    }
    let bucket = buckets.get(name);
    if (!bucket || bucket.until <= time) {
      if (!bucket && buckets.size >= maxKeys) throw reject('The site is busy. Please try again shortly.', 503);
      bucket = { count: 0, until: time + rule.window };
      buckets.set(name, bucket);
    }
    if (bucket.count >= rule.count)
      throw reject(
        'Too many requests. Please wait before trying again.',
        429,
        Math.max(1, Math.ceil((bucket.until - time) / 1000))
      );
    bucket.count++;
  }
  function category(path, method, key) {
    if (authPaths.has(path)) take('auth', key);
    else if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) take('write', key);
    if (isUpload(path, method)) take('upload', key);
  }
  return {
    before(ip, path, method) {
      take('ip', ip);
      category(path, method, 'ip:' + ip);
    },
    account(id, path, method) {
      take('account', id);
      category(path, method, 'user:' + id);
    },
    enter() {
      if (active >= maxActive) throw reject('The site is busy. Please try again shortly.', 503, 5);
      active++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          active--;
        }
      };
    },
    upload(id) {
      if (uploads.has(id))
        throw reject('You already have an upload in progress. Please wait for it to finish.', 429, 5);
      if (uploads.size >= maxUploads) throw reject('Uploads are busy. Please try again shortly.', 503, 5);
      uploads.add(id);
      let released = false;
      return () => {
        if (!released) {
          released = true;
          uploads.delete(id);
        }
      };
    },
  };
}

export function readRequestBody(req, limit, { totalMs = 30000, idleMs = 30000 } = {}) {
  return new Promise((resolve, rejectBody) => {
    const chunks = [];
    let size = 0,
      idle,
      total;
    const cleanup = () => {
      clearTimeout(idle);
      clearTimeout(total);
      for (const [name, fn] of listeners) req.removeListener(name, fn);
    };
    const fail = error => {
      cleanup();
      req.pause();
      rejectBody(error);
    };
    const timeout = () => fail(Object.assign(new Error('Upload timed out. Please try again.'), { status: 408 }));
    const reset = () => {
      clearTimeout(idle);
      idle = setTimeout(timeout, idleMs);
      idle.unref?.();
    };
    const onData = chunk => {
      size += chunk.length;
      if (size > limit) return fail(Object.assign(new Error('Upload is too large.'), { status: 413 }));
      chunks.push(chunk);
      reset();
    };
    const listeners = [
      ['data', onData],
      [
        'end',
        () => {
          cleanup();
          resolve(Buffer.concat(chunks, size));
        },
      ],
      ['aborted', () => fail(Object.assign(new Error('Upload interrupted.'), { status: 400 }))],
      ['error', fail],
    ];
    if (Number(req.headers['content-length']) > limit)
      return fail(Object.assign(new Error('Upload is too large.'), { status: 413 }));
    for (const [name, fn] of listeners) req.on(name, fn);
    total = setTimeout(timeout, totalMs);
    total.unref?.();
    reset();
  });
}
