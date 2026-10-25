import { randomBytes, createHash } from 'node:crypto';
import { fail, readJson, SESSION_MS, sessionCookie, clearedSessionCookie } from '../http.mjs';

const OAUTH_COOKIE = 'sideproj_oauth';
// The other account actions, by route, and the auth method that handles each.
const accountActions = {
  '/api/signup': 'signup',
  '/api/confirm': 'confirm',
  '/api/recover': 'recover',
  '/api/reset-password': 'reset',
};

// Signing in and out, Google sign-in, sign-up and its email confirmation, password recovery, and deleting the account.
export function authRoutes({ auth, sessions, deployment }) {
  // Google sign-ins in progress (PKCE verifier and origin), keyed by the sideproj_oauth cookie.
  const oauthAttempts = new Map();
  const startSession = nextSession => sessions.create({ ...nextSession, cookieExpires: Date.now() + SESSION_MS });
  const accountValues = async req => {
    const values = await readJson(req, 4096, 'Enter valid account details.');
    if (!values || typeof values !== 'object') throw fail('Enter valid account details.');
    return values;
  };
  return [
    {
      method: 'POST',
      path: '/api/auth/google',
      session: 'none',
      async handle({ req, res, json, appOrigin, cookieValue }) {
        if (req.headers.origin !== appOrigin) throw fail('Start Google sign-in from this site.', 403);
        for (const [id, attempt] of oauthAttempts) if (attempt.expires < Date.now()) oauthAttempts.delete(id);
        if (oauthAttempts.size >= 1000) throw fail('Please try again later.', 429);
        const verifier = randomBytes(32).toString('base64url'),
          attemptId = randomBytes(32).toString('base64url');
        const target = auth.googleUrl(
          appOrigin + '/auth/google/callback',
          createHash('sha256').update(verifier).digest('base64url')
        );
        const previous = cookieValue(OAUTH_COOKIE);
        if (previous) oauthAttempts.delete(previous);
        oauthAttempts.set(attemptId, { verifier, origin: appOrigin, expires: Date.now() + 600000 });
        res.setHeader(
          'Set-Cookie',
          OAUTH_COOKIE + '=' + attemptId + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=600' + deployment.secureCookie
        );
        return json(200, { url: target });
      },
    },
    {
      method: 'GET',
      path: '/auth/google/callback',
      session: 'none',
      async handle({ res, url, appOrigin, cookieValue }) {
        const id = cookieValue(OAUTH_COOKIE),
          attempt = oauthAttempts.get(id);
        oauthAttempts.delete(id);
        const cleared = OAUTH_COOKIE + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' + deployment.secureCookie;
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
          res.setHeader('Set-Cookie', [cleared, sessionCookie(await startSession(nextSession), deployment)]);
          res.writeHead(303, { Location: '/#explore' });
          return res.end();
        } catch {
          res.writeHead(303, { Location: '/?google_error=1#login' });
          return res.end();
        }
      },
    },
    {
      method: 'POST',
      path: '/api/login',
      async handle({ req, res, json, token }) {
        const nextSession = await auth.login(await accountValues(req));
        if (token) await sessions.remove(token);
        res.setHeader('Set-Cookie', sessionCookie(await startSession(nextSession), deployment));
        return json(200, { user: nextSession.user });
      },
    },
    {
      method: 'POST',
      path: Object.keys(accountActions),
      async handle({ req, url, json }) {
        const values = await accountValues(req);
        return json(200, await auth[accountActions[url.pathname]](values));
      },
    },
    {
      method: 'POST',
      path: '/api/logout',
      // The session is needed to sign out of Supabase, but not checked first.
      session: 'load',
      async handle({ res, json, session, token }) {
        // The cookie is cleared even if the saved session can't be deleted right now; Supabase's own logout below
        // still revokes its tokens, so it can't be used again.
        await sessions
          .remove(token)
          .catch(error => console.error('Could not delete the saved session:', error.message));
        res.setHeader('Set-Cookie', clearedSessionCookie(deployment));
        // The local session is invalidated even if Supabase is temporarily unavailable.
        await auth.logout(session).catch(() => {});
        return json(200, { user: null });
      },
    },
    { method: 'GET', path: '/api/session', handle: ({ json, user }) => json(200, { user }) },
    {
      method: 'DELETE',
      path: '/api/account',
      async handle({ req, res, json, user, session, appOrigin }) {
        if (!user) throw fail('Log in first.', 401);
        if (req.headers.origin !== appOrigin) throw fail('Delete your account from this site.', 403);
        const values = await readJson(req, 1024, 'Confirm account deletion.');
        if (values?.confirmation !== 'DELETE') throw fail('Type DELETE to confirm.');
        await auth.deleteAccount(session);
        // The account's saved sessions are deleted with it; this drops the ones cached by this server.
        await sessions.removeUser(user.id);
        res.setHeader('Set-Cookie', clearedSessionCookie(deployment));
        return json(200, { deleted: true });
      },
    },
  ];
}
