import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapBounds,renderOfflineMap,createOfflineMap} from '../offline-map.mjs';
import {offlineFilename} from '../offline-filename.mjs';
import {buildOfflineLocation} from '../offline-location.mjs';

const location={name:'Glen Clova',latitude:'56.8',longitude:'-3.1',boulders:[]};
const data={elements:[{tags:{highway:'secondary',ref:'B955 <script>'},geometry:[{lat:56.795,lon:-3.11},{lat:56.805,lon:-3.09}]}]};
test('offline filename is readable and safe on Windows',()=>{
 assert.equal(offlineFilename('Glen Clova'),'Glen Clova.html');
 assert.equal(offlineFilename('../CON'),'Location CON.html');
 assert.equal(offlineFilename(''),'Location.html');
 assert.ok(!offlineFilename('a/b\\c:<"x">').includes('/'));
});
test('road overview embeds a marker, attribution and scale without remote imagery',()=>{
 const map=renderOfflineMap(data,mapBounds(location));
 assert.match(map,/500 m/);assert.match(map,/OpenStreetMap contributors/);
 assert.match(map,/cx="400" cy="250"/);assert.match(map,/B955 &lt;script&gt;/);
 assert.ok(!map.includes('<script>'));assert.ok(!map.includes('<image'));
 const {html}=buildOfflineLocation(location,new Date(),map);
 assert.match(html,/Photos or videos not loading/);assert.match(html,/Glen Clova.html/);
 assert.match(html,/Nearby roads and paths/);assert.ok(!html.includes('map was unavailable'));
 assert.equal(mapBounds({...location,latitude:'NaN'}),null);
});
test('map provider caches data and tolerates unavailable or partial map responses',async()=>{
 let calls=0;
 const load=createOfflineMap({fetchImpl:async(url,options)=>{calls++;assert.ok(String(options.body).includes('way'));return new Response(JSON.stringify(data));}});
 const signal=new AbortController().signal;
 const first=await load(location,signal);assert.ok(first.includes('<svg'));
 assert.equal(await load(location,signal),first);assert.equal(calls,1);
 for(const result of [new Response('',{status:503}),new Response(JSON.stringify({remark:'timeout',...data}))]) {
  const unavailable=createOfflineMap({fetchImpl:async()=>result});assert.equal(await unavailable(location,signal),'');
 }
});
