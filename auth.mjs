import { loadEnv } from 'vite';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// Only the publishable key is needed. Passwords and tokens are never written to disk.
export function createAuth({ env = { ...loadEnv('development', process.cwd(), ''), ...process.env }, fetchImpl = fetch } = {}) {
  const base = env.SUPABASE_URL?.replace(/\/$/, '');
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  async function request(route, values, token, method = 'POST') {
    if (!base || !key) throw fail('Account service is not configured. Set the Supabase environment variables and restart.', 503);
    let response;
    try {
      response = await fetchImpl(base + route, { method, headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(method !== 'GET' ? { body: JSON.stringify(values || {}) } : {}), signal: AbortSignal.timeout(15000) });
    } catch { throw fail('Account service is unavailable. Please try again.', 503); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (route.startsWith('/rest/')) throw fail('Account permissions could not be loaded. Apply the account-access SQL migration.', 503);
      throw fail(response.status === 429 ? 'Too many attempts. Please wait before trying again.' : data.msg || data.message || data.error_description || 'Account request failed.', response.status === 429 ? 429 : 401);
    }
    return data;
  }
  async function identity(accessToken) {
    const account = await request('/auth/v1/user', null, accessToken, 'GET');
    if (!account.email_confirmed_at) throw fail('Confirm your email before logging in.', 401);
    const rows = await request('/rest/v1/rpc/current_account', {}, accessToken);
    const profile = rows[0];
    if (!profile || profile.id !== account.id || !['admin', 'contributor'].includes(profile.role)) throw fail('Your account profile is missing.', 403);
    return { id: account.id, email: account.email, name: profile.display_name, role: profile.role };
  }
  return {
    async login(values) {
      if (typeof values.email !== 'string' || typeof values.password !== 'string') throw fail('Enter your email and password.', 401);
      const session = await request('/auth/v1/token?grant_type=password', { email: values.email.trim(), password: values.password });
      return { accessToken: session.access_token, refreshToken: session.refresh_token, expires: Date.now() + session.expires_in * 1000, user: await identity(session.access_token) };
    },
    async resolve(session) {
      // A shared promise prevents concurrent requests from reusing a rotated refresh token.
      if (session.expires < Date.now() + 30000) {
        if (!session.refreshing) session.refreshing = request('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refreshToken }).then(next => {
          session.accessToken = next.access_token; session.refreshToken = next.refresh_token; session.expires = Date.now() + next.expires_in * 1000;
        }).finally(() => { delete session.refreshing; });
        await session.refreshing;
      }
      return identity(session.accessToken);
    },
    async signup(values) {
      if (typeof values.name !== 'string' || !values.name.trim() || values.name.trim().length > 120 || typeof values.email !== 'string' || typeof values.password !== 'string' || values.password.length < 12) throw fail('Provide a display name, email and a password of at least 12 characters.');
      await request('/auth/v1/signup', { email: values.email.trim(), password: values.password, data: { display_name: values.name.trim() } });
      return { message: 'Check your email for a confirmation code. If you already have an account, log in instead.' };
    },
    async confirm(values) {
      if (typeof values.email !== 'string' || typeof values.code !== 'string') throw fail('Enter your email and confirmation code.');
      const session = await request('/auth/v1/verify', { email: values.email.trim(), token: values.code.trim(), type: 'signup' });
      // Confirmation is separate from logging in to the local app.
      if (session.access_token) await request('/auth/v1/logout?scope=local', {}, session.access_token);
      return { message: 'Email confirmed. You can now log in.' };
    },
    async recover(values) {
      if (typeof values.email !== 'string' || !values.email.trim()) throw fail('Enter your email.');
      await request('/auth/v1/recover', { email: values.email.trim() });
      return { message: 'If an account exists, a recovery code has been emailed to you.' };
    },
    async reset(values) {
      if (typeof values.password !== 'string' || values.password.length < 12 || typeof values.code !== 'string' || typeof values.email !== 'string') throw fail('Enter your email, recovery code and a password of at least 12 characters.');
      const session = await request('/auth/v1/verify', { email: values.email.trim(), token: values.code.trim(), type: 'recovery' });
      await request('/auth/v1/user', { password: values.password }, session.access_token, 'PUT');
      await request('/auth/v1/logout?scope=global', {}, session.access_token);
      return { message: 'Password updated. Log in with your new password.' };
    },
    async logout(session) { if (session) await request('/auth/v1/logout?scope=local', {}, session.accessToken); },
  };
}
