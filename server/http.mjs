import { readRequestBody } from './request-limits.mjs';

// Errors carrying a status are sent to the client with their message; any other error becomes a generic 500.
export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A JSON request body of at most `limit` bytes. Any problem reading it is reported as `message`, unless `keepStatus`,
// which keeps the body reader's own errors (too large, timed out).
export async function readJson(req, limit, message, { keepStatus = false } = {}) {
  try {
    return JSON.parse((await readRequestBody(req, limit)).toString());
  } catch (e) {
    if (keepStatus && e.status) throw e;
    throw fail(message);
  }
}

// Adding to the guide (saving, uploading) needs an account with a completed profile.
export function requireContributor(user) {
  if (user?.profileComplete === false) throw fail('Complete your profile before contributing.', 403);
  if (!user) throw fail('Log in to contribute.', 401);
}

// The sideproj_session cookie, which lasts as long as the server-side session (a day), and the header that clears it.
export const SESSION_MS = 86400000;
export const sessionCookie = (token, deployment) =>
  `sideproj_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` +
  deployment.secureCookie;
export const clearedSessionCookie = deployment =>
  'sideproj_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' + deployment.secureCookie;
