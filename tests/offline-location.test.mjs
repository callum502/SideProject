import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildOfflineLocation,locationArchive,zipFiles} from '../offline-location.mjs';
import {createGuideServer} from '../server.mjs';
import {fakeAuth} from './fake-auth.mjs';

const owner='11111111-1111-4111-8111-111111111111';
const photo={id:'photo',name:'Face <script>alert(1)</script>',url:`/media/${owner}/a.jpg`,caption:'Parking caption',createdByName:'Climber'};
const video={id:'video',name:'Beta',url:`/media/${owner}/b.mov`};
const location={id:owner,name:'Test <location>',latitude:'56',longitude:'-4',approach:'Park here\nWalk uphill',photos:[photo],links:[{label:'Bad',url:'javascript:alert(1)'},{label:'Book',url:'https://example.com'}],boulders:[{id:'b',name:'Boulder',notes:'Finding notes',otherNotes:'Tidal',images:[photo],videos:[video],problems:[{id:'p',name:'Problem',grade:'V4',description:'Sit start',imageIds:['photo'],videoIds:['video'],photoAnnotations:{photo:[{type:'box',color:'green',x:1,y:2,x2:30,y2:40}]}}]}]};

test('offline guide contains all details, local media, independent annotations and escaped input',()=>{
 const {html,files}=buildOfflineLocation(location);
 assert.equal(files.length,2);
 for(const text of ['Finding notes','Tidal','Sit start','Parking caption','V4','Park here','media/001.jpg','media/002.mov','stroke="#35df79"'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('javascript:'));
 assert.ok(html.includes('&lt;location&gt;'));
 assert.ok(!/\b(?:src|href)="\/media\//.test(html));
 assert.equal((html.match(/<svg /g)||[]).length,1);
});

test('ZIP64 stores actual media bytes once and produces a central directory',async()=>{
 const calls=[];
 const storage={download:async(path)=>{calls.push(path);return new Response(Buffer.from(path),{headers:{'Content-Length':String(Buffer.byteLength(path))}});}};
 const entries=[];
 for await(const entry of locationArchive(location,storage,new AbortController().signal))entries.push(entry);
 const chunks=[];for await(const chunk of zipFiles(entries))chunks.push(chunk);
 const zip=Buffer.concat(chunks);
 assert.equal(calls.length,2);
 assert.equal(zip.readUInt32LE(0),0x04034b50);
 assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
 const zip64=Number(zip.readBigUInt64LE(zip.length-34));
 assert.equal(zip.readUInt32LE(zip64),0x06064b50);
 assert.equal(zip.readBigUInt64LE(zip64+32),5n);
 let cursor=Number(zip.readBigUInt64LE(zip64+48));
 const names=[];
 for(let i=0;i<5;i++){
  assert.equal(zip.readUInt32LE(cursor),0x02014b50);
  const nameSize=zip.readUInt16LE(cursor+28),extraSize=zip.readUInt16LE(cursor+30);
  const name=zip.toString('utf8',cursor+46,cursor+46+nameSize);names.push(name);
  const extra=cursor+46+nameSize,size=Number(zip.readBigUInt64LE(extra+4)),offset=Number(zip.readBigUInt64LE(extra+20));
  const start=offset+30+zip.readUInt16LE(offset+26)+zip.readUInt16LE(offset+28);
  if(name.startsWith('media/'))assert.equal(zip.toString('utf8',start,start+size),calls[names.filter(n=>n.startsWith('media/')).length-1]);
  cursor+=46+nameSize+extraSize;
 }
 assert.deepEqual(names,['index.html','README.txt','location.json','media/001.jpg','media/002.mov']);
});

test('missing media and truncated responses fail the archive instead of omitting files',async()=>{
 const storage={download:async()=>new Response('short',{headers:{'Content-Length':'100'}})};
 await assert.rejects(async()=>{for await(const chunk of zipFiles(locationArchive(location,storage,new AbortController().signal)))void chunk;},/Incomplete/);
 await assert.rejects(async()=>{for await(const chunk of zipFiles([{name:'../escape',body:[]}]))void chunk;},/Unsafe/);
});

test('location export HTTP route downloads a ZIP and handles unknown locations',async()=>{
 const {server}=await createGuideServer({auth:fakeAuth(),contentStore:{read:async()=>({locations:[location]})},storage:{download:async()=>new Response('file')}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const result=await fetch(base+'/api/location-download?id='+owner);
  assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'application/zip');
  assert.match(result.headers.get('content-disposition'),/offline.zip/);
  const zip=Buffer.from(await result.arrayBuffer());assert.equal(zip.readUInt32LE(0),0x04034b50);
  assert.equal((await fetch(base+'/api/location-download?id=22222222-2222-4222-8222-222222222222')).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
