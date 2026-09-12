import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGuideServer} from '../server.mjs';
import {fakeAuth} from './fake-auth.mjs';

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
