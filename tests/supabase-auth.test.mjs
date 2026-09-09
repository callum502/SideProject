import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../auth.mjs';
import { claimLegacyAdmin } from '../ownership.mjs';

const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'public-test-key' };
function fixture({ confirmed = true } = {}) {
  const calls = [];
  let role = 'contributor', refreshes = 0;
  const auth = createAuth({ env, fetchImpl: async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, options, body });
    let result = {};
    if (url.includes('grant_type=')) {
      if (url.includes('refresh_token')) { refreshes++; await new Promise(resolve => setTimeout(resolve, 10)); }
      result = { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 };
    } else if (url.endsWith('/auth/v1/user') && options.method === 'GET') result = { id: 'account-id', email: 'climber@example.com', email_confirmed_at: confirmed ? '2026-09-09' : null, user_metadata: { role: 'admin' } };
    else if (url.endsWith('/rpc/current_account')) result = [{ id: 'account-id', display_name: 'Climber', role }];
    else if (url.endsWith('/verify')) result = { access_token: 'recovery-access' };
    return new Response(JSON.stringify(result), { status: 200 });
  } });
  return { auth, calls, setRole: value => { role = value; }, refreshes: () => refreshes };
}

test('verified database roles override editable metadata and role changes apply to existing sessions', async () => {
  const f = fixture();
  const session = await f.auth.login({ email: 'climber@example.com', password: 'test-password' });
  assert.equal(session.user.role, 'contributor');
  f.setRole('admin'); assert.equal((await f.auth.resolve(session)).role, 'admin');
  f.setRole('contributor'); assert.equal((await f.auth.resolve(session)).role, 'contributor');
  const unconfirmed = fixture({ confirmed: false });
  await assert.rejects(unconfirmed.auth.login({ email: 'climber@example.com', password: 'test-password' }), /Confirm your email/);
  assert.ok(!unconfirmed.calls.some(call => call.url.includes('/rpc/')));
});

test('concurrent requests refresh a session only once', async () => {
  const f = fixture();
  const session = await f.auth.login({ email: 'climber@example.com', password: 'test-password' });
  session.expires = 0;
  await Promise.all([f.auth.resolve(session), f.auth.resolve(session)]);
  assert.equal(f.refreshes(), 1);
  assert.ok(session.expires > Date.now());
});

test('signup strips role metadata; confirmation and recovery use email codes', async () => {
  const f = fixture();
  await f.auth.signup({ name: ' Admin ', email: 'climber@example.com', password: 'strong-password', role: 'admin', data: { role: 'admin' } });
  assert.deepEqual(f.calls[0].body.data, { display_name: 'Admin' });
  await f.auth.confirm({ email: 'climber@example.com', code: '123456' });
  assert.equal(f.calls.find(call => call.url.endsWith('/verify')).body.type, 'signup');
  await f.auth.recover({ email: 'climber@example.com' });
  await f.auth.reset({ email: 'climber@example.com', code: '654321', password: 'new-strong-password' });
  const update = f.calls.find(call => call.options.method === 'PUT');
  assert.equal(update.options.headers.Authorization, 'Bearer recovery-access');
  assert.deepEqual(update.body, { password: 'new-strong-password' });
  assert.ok(f.calls.some(call => call.url.includes('scope=global')));
  await assert.rejects(f.auth.reset({ email: 'a', code: '123456', password: 'short' }), /at least 12/);
});

test('missing config and rejected authentication fail closed', async () => {
  const auth = createAuth({ env: {} });
  await assert.rejects(auth.login({ email: 'a', password: 'b' }), error => error.status === 503);
  const rejected = createAuth({ env, fetchImpl: async () => new Response(JSON.stringify({ msg: 'Invalid login credentials' }), { status: 400 }) });
  await assert.rejects(rejected.login({ email: 'a', password: 'b' }), error => error.status === 401);
});

test('legacy ownership migration preserves contributor and individual authors', () => {
  const guide = { locations: [{ createdBy: 'Admin', boulders: [{ createdBy: 'Contributor', problems: [{ createdBy: 'Admin' }], images: [{ createdBy: 'other-uuid' }] }] }] };
  assert.equal(claimLegacyAdmin(guide, { id: 'admin-uuid', name: 'Callum' }), true);
  assert.equal(guide.locations[0].createdBy, 'admin-uuid');
  assert.equal(guide.locations[0].createdByName, 'Callum');
  assert.equal(guide.locations[0].boulders[0].createdBy, 'Contributor');
  assert.equal(guide.locations[0].boulders[0].problems[0].createdBy, 'admin-uuid');
  assert.equal(guide.locations[0].boulders[0].images[0].createdBy, 'other-uuid');
  assert.equal(claimLegacyAdmin(guide, { id: 'admin-uuid', name: 'Callum' }), false);
});
