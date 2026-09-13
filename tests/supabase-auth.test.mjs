import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../auth.mjs';

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
  await f.auth.signup({ name: ' Admin ', height:'180', apeIndex:'2', email: 'climber@example.com', password: 'strong-password', role: 'admin', data: { role: 'admin' } });
  assert.deepEqual(f.calls.find(call => call.url.endsWith('/auth/v1/signup')).body.data, { display_name: 'Admin', height_cm:180, ape_index_inches:2 });
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

test('Google uses PKCE exchange and database roles rather than provider metadata',async()=>{
 const f=fixture();const url=new URL(f.auth.googleUrl('https://sideproj.rocks/auth/google/callback','challenge'));
 assert.equal(url.searchParams.get('provider'),'google');assert.equal(url.searchParams.get('code_challenge_method'),'s256');
 const session=await f.auth.exchangeGoogle('code','verifier');assert.equal(session.user.role,'contributor');
 const exchange=f.calls.find(c=>c.url.includes('grant_type=pkce'));assert.deepEqual(exchange.body,{auth_code:'code',code_verifier:'verifier'});
 await assert.rejects(fixture({confirmed:false}).auth.exchangeGoogle('code','verifier'),/Confirm your email/);
});

test('signup requires valid profile measurements',async()=>{const f=fixture();await assert.rejects(f.auth.signup({name:'Test',email:'a@b.com',password:'strong-password'}),/height/);await assert.rejects(f.auth.signup({name:'Test',height:'180',apeIndex:'9'}),/ape index/);});

test('taken names stop signup and profile edits before writing', async () => {
 const calls=[];
 const auth=createAuth({env,fetchImpl:async(url,options)=>{calls.push(url);return new Response('false',{status:200});}});
 const values={name:'Taken',height:180,apeIndex:'unknown',email:'test@example.com',password:'strong-password'};
 await assert.rejects(auth.signup(values),/already taken/);
 await assert.rejects(auth.completeProfile(values,{accessToken:'access'}),/already taken/);
 assert.ok(calls.every(url=>url.endsWith('/rpc/display_name_available')));
});

test('account errors identify failing function and database code without exposing response details',async()=>{
 const auth=createAuth({env,fetchImpl:async url=>url.endsWith('/auth/v1/user') ? new Response(JSON.stringify({id:'account',email_confirmed_at:'2026-09-09'})) : new Response(JSON.stringify({code:'42501',message:'private diagnostic details'}),{status:403})});
 await assert.rejects(auth.resolve({expires:Date.now()+600000,accessToken:'token'}),error=>error.message.includes('current_account: 42501') && !error.message.includes('private diagnostic'));
});
