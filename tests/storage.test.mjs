import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createStorage} from '../storage.mjs';
import {mediaReference,MAX_VIDEO_BYTES} from '../media-reference.mjs';
import {createGuideServer} from '../server.mjs';
import {fakeAuth} from './fake-auth.mjs';
const owner='00000000-0000-4000-8000-000000000001';
const filename='10000000-0000-4000-8000-000000000001.png';
const cloudPath=owner+'/'+filename;
const env={MEDIA_STORE:'supabase',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-key'};
function fixture(){
  const objects=new Map();const calls=[];let corrupt=false;
  const storage=createStorage({env,fetchImpl:async(url,options)=>{
    calls.push({url,options});
    const key=url.split('sideproj-media/')[1];
    if(options.method==='POST'){
      if(objects.has(key))return new Response(JSON.stringify({error:'Duplicate'}),{status:409});
      objects.set(key,{bytes:Buffer.from(options.body),mime:options.headers['Content-Type']});return new Response('{}');
    }
    const obj=objects.get(key);if(!obj)return new Response('{}',{status:404});
    const bytes=corrupt?Buffer.from('different bytes'):obj.bytes;
    return new Response(options.method==='HEAD'?null:bytes,{headers:{'Content-Length':String(bytes.length),'Content-Type':obj.mime}});
  }});
  return {storage,objects,calls,corrupt:()=>{corrupt=true;}};
}
test('Storage uploads never overwrite existing objects and only accept safe cloud paths',async()=>{
 const f=fixture(),bytes=Buffer.from('file bytes');
 await f.storage.upload(cloudPath,bytes,'image/png','session');
 await assert.rejects(f.storage.upload(cloudPath,bytes,'image/png','session'));
 assert.equal(f.objects.size,1);
 assert.equal(f.calls[0].options.headers['x-upsert'],'false');
 assert.equal(f.calls[0].options.headers.Authorization,'Bearer session');
 assert.deepEqual(await f.storage.stat(cloudPath,'session'),{size:bytes.length,mime:'image/png'});
 assert.equal(mediaReference('/media/../../secrets'),null);
 assert.equal(mediaReference('/uploads/'+filename),null);
 assert.equal(mediaReference('https://evil.example/file.png'),null);
 assert.equal(MAX_VIDEO_BYTES,104857600);
 await assert.rejects(f.storage.upload(cloudPath,{length:MAX_VIDEO_BYTES+1},'video/mp4','session'),error=>error.status===413);
});

test('HTTP cloud uploads do not write local files; retired migration endpoints are absent and playback redirects safely',async()=>{
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'sideproj-storage-'));let server;
 try{
  const auth=fakeAuth();const baseLogin=auth.login;auth.login=async value=>({...await baseLogin(value),accessToken:'token'});
  const f=fixture();const contentStore={};
  ({server}=await createGuideServer({auth,storage:f.storage,contentStore}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/api/storage/migration')).status,404);
  async function login(email){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'test-password'})});return r.headers.get('set-cookie').split(';')[0];}
  const contributor=await login('contributor@example.com');
  assert.equal((await fetch(base+'/api/storage/migration',{headers:{Cookie:contributor}})).status,404);
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]);
  const response=await fetch(base+'/api/images',{method:'POST',headers:{Cookie:contributor,'Content-Type':'image/png'},body:bytes});
  assert.equal(response.status,201);const {url}=await response.json();assert.ok(url.startsWith('/media/'));
  const redirect=await fetch(base+url,{redirect:'manual'});assert.equal(redirect.status,302);assert.ok(redirect.headers.get('location').startsWith('https://test.supabase.co/storage/v1/object/public/sideproj-media/'));
  await assert.rejects(readFile(path.join(dataDir,'uploads',url.split('/').pop())));
  const download=await fetch(base+url+'?download=beta.mov',{redirect:'manual'});assert.equal(new URL(download.headers.get('location')).searchParams.get('download'),'beta.mov');
  const admin=await login('admin@example.com');assert.equal((await fetch(base+'/api/storage/migration',{headers:{Cookie:admin}})).status,404);
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(!path.resolve(dataDir).startsWith(path.resolve(os.tmpdir())+path.sep+'sideproj-storage-'))throw new Error('Unsafe cleanup');await rm(dataDir,{recursive:true,force:true});}
});
