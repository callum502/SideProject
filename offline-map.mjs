const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mapBounds(location) {
 const lat=Number(location.latitude),lon=Number(location.longitude);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>80||Math.abs(lon)>180)return null;
 const dy=1250/111320,dx=2000/(111320*Math.cos(lat*Math.PI/180));
 if(lon-dx< -180||lon+dx>180)return null;
 return {lat,lon,south:lat-dy,north:lat+dy,west:lon-dx,east:lon+dx};
}
export function renderOfflineMap(data,bounds) {
 const {south,north,west,east}=bounds;
 const project=p=>[(p.lon-west)/(east-west)*800,(north-p.lat)/(north-south)*500];
 const valid=p=>Number.isFinite(p?.lat)&&Number.isFinite(p?.lon);
 const paths=[],labels=[],occupied=new Set();
 for(const way of (data.elements||[]).slice(0,5000)) {
  const points=(way.geometry||[]).filter(valid);if(points.length<2)continue;
  const tags=way.tags||{},water=!!tags.waterway,minor=['path','footway','track','bridleway','steps','cycleway'].includes(tags.highway);
  const major=['motorway','trunk','primary','secondary'].includes(tags.highway);
  const coordinates=points.map(p=>project(p).map(n=>n.toFixed(1)).join(',')).join(' ');
  paths.push(`<polyline points="${coordinates}" fill="none" stroke="${water?'#80b8cc':minor?'#8b967c':major?'#d9ac64':'#b7b1a2'}" stroke-width="${water?2:minor?1.5:major?5:3}" ${minor?'stroke-dasharray="5 4"':''}/>`);
  const name=tags.ref||tags.name;
  if(name && !minor && labels.length<16) {
   const [x,y]=project(points[Math.floor(points.length/2)]),cell=`${Math.floor(x/150)},${Math.floor(y/60)}`;
   if(x>50&&x<750&&y>30&&y<450&&!occupied.has(cell)) {
    occupied.add(cell);labels.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="13" fill="#34463d" stroke="#f0f2e7" stroke-width="4" paint-order="stroke">${escape(String(name).slice(0,60))}</text>`);
   }
  }
 }
 if(!paths.length)return '';
 return `<figure style="margin:16px 0"><svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Static map showing nearby roads and the location" viewBox="0 0 800 500" style="display:block;width:100%;height:auto;background:#edf0e3;border-radius:12px;font-family:system-ui,sans-serif;overflow:hidden"><defs><clipPath id="map-area"><rect width="800" height="500"/></clipPath></defs><g clip-path="url(#map-area)">${paths.join('')}${labels.join('')}</g><circle cx="400" cy="250" r="12" fill="#bb492f" stroke="white" stroke-width="4"/><text x="400" y="225" text-anchor="middle" font-size="15" fill="#23382c" stroke="white" stroke-width="4" paint-order="stroke">Location</text><text x="765" y="30" font-size="18" text-anchor="middle">N ↑</text><path d="M30 450v10h100v-10" fill="none" stroke="#23382c" stroke-width="3"/><text x="80" y="480" text-anchor="middle" font-size="14">500 m</text></svg><figcaption>Nearby roads and paths · approximately 4 km across. Static overview, not turn-by-turn directions.<br>Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, available under the <a href="https://opendatacommons.org/licenses/odbl/1-0/">Open Database License</a>.</figcaption></figure>`;
}

export function createOfflineMap({fetchImpl=fetch}={}) {
 const cache=new Map();
 return async(location,signal)=>{
  const bounds=mapBounds(location);if(!bounds)return '';
  const key=`${bounds.lat},${bounds.lon}`,cached=cache.get(key);
  if(cached && cached.expires>Date.now())return cached.svg;
  try {
   const bbox=[bounds.south,bounds.west,bounds.north,bounds.east].join(',');
   const query=`[out:json][timeout:12];(way[highway](${bbox});way[waterway](${bbox}););out geom;`;
   const response=await fetchImpl('https://overpass-api.de/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'SideProj/1.0 (+https://sideproj.rocks)'},body:new URLSearchParams({data:query}),signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),redirect:'error'});
   if(!response.ok || !response.body)throw Error('Map unavailable');
   const chunks=[];let size=0;
   for await(const chunk of response.body){size+=chunk.length;if(size>4*1024*1024)throw Error('Map response too large');chunks.push(Buffer.from(chunk));}
   const data=JSON.parse(Buffer.concat(chunks).toString());
   if(data.remark)throw Error('Incomplete map response');
   const svg=renderOfflineMap(data,bounds);
   if(cache.size>=32)cache.delete(cache.keys().next().value);
   cache.set(key,{svg,expires:Date.now()+86400000});return svg;
  } catch(error) {
   if(signal.aborted)throw error;
   // Keep the full location/media export usable if the community map API is busy.
   return '';
  }
 };
}
