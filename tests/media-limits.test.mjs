import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationMediaCount, checkMediaCapacity, enforceMediaLimits } from '../media-limits.mjs';

test('combined location cap includes parking and all boulders, without counting problem links', () => {
 const location={id:'a',photos:Array(10).fill({}),boulders:[
  {images:Array(15).fill({}),videos:Array(10).fill({}),problems:[{imageIds:['shared'],videoIds:['shared']}]},
  {images:[],videos:Array(14).fill({})}
 ]};
 assert.equal(locationMediaCount(location),49);
 checkMediaCapacity(location,1);
 assert.throws(()=>checkMediaCapacity(location,2),/maximum of 50/);
 const next=structuredClone(location);next.photos.push({},{});
 assert.throws(()=>enforceMediaLimits({locations:[location]},{locations:[next]}),/maximum of 50/);
 enforceMediaLimits({locations:[next]},{locations:[next]});
 enforceMediaLimits({locations:[next]},{locations:[location]});
});
