import { duplicateMediaName } from '../media-names.mjs';
﻿import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGuideServer} from '../server.mjs';
import {fakeAuth} from './fake-auth.mjs';
import {deploymentConfig} from '../deployment.mjs';
import http from 'node:http';

test('Render accepts configured HTTPS origins and sets secure cookies behind its proxy',async()=>{
 const deployment=deploymentConfig({RENDER:'true',RENDER_EXTERNAL_URL:'https://sideproj.onrender.com',APP_ORIGINS:'https://sideproj.rocks, https://www.sideproj.rocks'});
 assert.equal(deployment.host,'0.0.0.0');
 assert.equal(deploymentConfig({}).host,'127.0.0.1');
 assert.throws(()=>deploymentConfig({NODE_ENV:'production'}));
 assert.throws(()=>deploymentConfig({APP_ORIGINS:'http://sideproj.rocks'}));
 const {server}=await createGuideServer({deployment,auth:fakeAuth(),storage:{},contentStore:{}});
 await new Promise(r=>server.listen(0,deployment.host,r));
 const request=(route,host,origin,method='GET',value)=>new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method,headers:{Host:host,...(origin?{Origin:origin}:{}),'Content-Type':'application/json'}},res=>{
   res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:res.headers}));
  });req.on('error',reject);req.end(value?JSON.stringify(value):undefined);
 });
 try {
  for(const host of ['sideproj.rocks','www.sideproj.rocks','sideproj.onrender.com'])assert.equal((await request('/api/session',host,'https://'+host)).status,200);
  assert.equal((await request('/api/session','evil.example')).status,403);
  assert.equal((await request('/api/session','sideproj.rocks','https://evil.example')).status,403);
  assert.equal((await request('/api/session','sideproj.rocks','http://sideproj.rocks')).status,403);
  assert.equal((await request('/api/session','sideproj.rocks','https://www.sideproj.rocks')).status,403);
  assert.equal((await request('/healthz','internal-probe')).status,200);
  const login=await request('/api/login','sideproj.rocks','https://sideproj.rocks','POST',{email:'contributor@example.com',password:'test-password'});
  assert.equal(login.status,200);assert.match(login.headers['set-cookie'][0],/; Secure/);
  const logout=await request('/api/logout','sideproj.rocks','https://sideproj.rocks','POST',{});
  assert.equal(logout.status,200);assert.match(logout.headers['set-cookie'][0],/Max-Age=0; Secure/);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('cloud API requires login, forwards verified tokens, validates writes and invalidates logout',async()=>{
 const auth=fakeAuth(),login=auth.login;auth.login=async credentials=>({...await login(credentials),accessToken:'verified-token'});
 let saved;const contentStore={async read(){return {revision:0,locations:[]};},async save(value,user,token){saved={value,user,token};return {...value,revision:1};}};
 const {server}=await createGuideServer({auth,contentStore,storage:{}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const request=(route,method='GET',value,cookie,headers={})=>fetch(base+route,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(value?{body:JSON.stringify(value)}:{})});
 try{
  assert.deepEqual(await request('/api/guide').then(r=>r.json()),{revision:0,locations:[]});
  assert.equal((await request('/api/guide','PUT',{revision:0,locations:[]})).status,401);
  assert.equal((await request('/api/images','POST',{})).status,401);
  assert.equal((await request('/api/login','POST',{email:'admin@example.com',password:'wrong'})).status,401);
  const response=await request('/api/login','POST',{email:'contributor@example.com',password:'test-password'});
  const cookie=response.headers.get('set-cookie').split(';')[0];assert.ok(response.headers.get('set-cookie').includes('HttpOnly'));
  const data=await response.json();assert.equal(data.user.role,'contributor');assert.equal(data.accessToken,undefined);
  assert.equal((await request('/api/guide','PUT',{revision:0,locations:[]},cookie)).status,200);
  assert.equal(saved.token,'verified-token');assert.equal(saved.user.id,auth.users.Contributor.id);
  assert.equal((await request('/api/guide','PUT',{revision:0,locations:[{id:'bad'}]},cookie)).status,400);
  assert.equal((await request('/api/guide','PUT',{revision:0,locations:[]},cookie,{Origin:'https://untrusted.example'})).status,403);
  for(const route of ['/api/storage/migration','/api/media-settings','/uploads/anything.png'])assert.equal((await request(route)).status,404);
  await request('/api/logout','POST',{},cookie);
  assert.equal((await request('/api/guide','PUT',{revision:0,locations:[]},cookie)).status,401);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('media names reject existing and batch duplicates regardless of case or surrounding whitespace',()=>{
 assert.equal(duplicateMediaName([{name:'Photo 1'}],[' photo 1 ']),' photo 1 ');
 assert.equal(duplicateMediaName([],['Beta','BETA']),'BETA');
 assert.equal(duplicateMediaName([{name:'Photo 1'}],['Photo 2','Photo 3']),null);
});

test('Google callback requires browser cookie, rejects replay and creates a server session',async()=>{
 let exchanges=0,challenge;
 const auth=fakeAuth();auth.googleUrl=(redirect,c)=>{challenge=c;return 'https://test.supabase.co/auth/v1/authorize?redirect_to='+encodeURIComponent(redirect);};
 auth.exchangeGoogle=async(code,verifier)=>{exchanges++;assert.equal(code,'valid');assert.ok(verifier.length>=43);return {user:auth.users.Contributor,accessToken:'private-token'};};
 const {server}=await createGuideServer({auth,storage:{},contentStore:{}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 try {
  assert.equal((await fetch(base+'/api/auth/google',{method:'POST',headers:{Origin:'https://evil.example'}})).status,403);
  const start=await fetch(base+'/api/auth/google',{method:'POST',headers:{Origin:base}});assert.equal(start.status,200);
  const cookie=start.headers.get('set-cookie').split(';')[0];assert.match(start.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);assert.ok(challenge);
  const missing=await fetch(base+'/auth/google/callback?code=valid',{redirect:'manual'});assert.equal(missing.headers.get('location'),'/?google_error=1#login');assert.equal(exchanges,0);
  const done=await fetch(base+'/auth/google/callback?code=valid',{redirect:'manual',headers:{Cookie:cookie}});assert.equal(done.headers.get('location'),'/#explore');assert.equal(exchanges,1);
  assert.ok(!done.headers.get('set-cookie').includes('private-token'));
  const replay=await fetch(base+'/auth/google/callback?code=valid',{redirect:'manual',headers:{Cookie:cookie}});assert.equal(replay.headers.get('location'),'/?google_error=1#login');assert.equal(exchanges,1);
 } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
