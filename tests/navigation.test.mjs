import {test} from 'node:test';
import assert from 'node:assert/strict';
test('Back follows visited profiles and problems, supports forward, and falls back for direct links',async()=>{
 const listeners=new Map();let cursor=0;const entries=[{url:'https://test/#user=alice',state:null}];
 const emit=type=>(listeners.get(type)||[]).forEach(fn=>fn());
 const browser={location:{get href(){return entries[cursor].url;}},history:{
  get state(){return entries[cursor].state;},
  replaceState(state,title,url){entries[cursor]={state,url:url?new URL(url,entries[cursor].url).href:entries[cursor].url};},
  back(){if(cursor>0){cursor--;emit('popstate');emit('hashchange');}}
 },addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)||[]),fn]);},dispatchEvent(event){emit(event.type);}};
 const previousWindow=globalThis.window,previousEvent=globalThis.HashChangeEvent;
 globalThis.window=browser;globalThis.HashChangeEvent=class{constructor(type){this.type=type;}};
 try{
 const {goBack}=await import('../src/navigation.mjs');
 goBack();assert.equal(browser.location.href,'https://test/#explore');assert.equal(cursor,0);
 function visit(hash){entries.splice(cursor+1);entries.push({url:'https://test/'+hash,state:null});cursor++;emit('popstate');emit('hashchange');}
 visit('#user=alice');visit('#location=l&boulder=b&problem=p');
 goBack('#location=l&boulder=b');assert.equal(browser.location.href,'https://test/#user=alice');
 cursor++;emit('popstate');emit('hashchange');goBack();assert.equal(browser.location.href,'https://test/#user=alice');
 goBack();assert.equal(browser.location.href,'https://test/#explore');
 visit('#location=new');goBack();assert.equal(browser.location.href,'https://test/#explore');
 }finally{globalThis.window=previousWindow;globalThis.HashChangeEvent=previousEvent;}
});
