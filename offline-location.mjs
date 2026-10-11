import { offlineFilename } from './offline-filename.mjs';
import { mediaReference } from './media-reference.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const note = (title,value) => value ? `<section><h3>${esc(title)}</h3><p class="notes">${esc(value)}</p></section>` : '';
const credit = item => `<p class="credit">Created by ${esc(item.createdByName || (item.createdBy ? 'Climber' : 'Deleted User'))}</p>`;
const number = value => Number.isFinite(Number(value)) ? Math.max(0,Math.min(1000,Number(value))) : 0;

function annotations(items=[]) {
 const shapes=items.map(s=>{
  const x=number(s.x),y=number(s.y),x2=number(s.x2),y2=number(s.y2);
  const color=s.color==='green'?'#35df79':'#ff2929';
  let shape='';
  if(s.type==='box')shape=`<rect x="${Math.min(x,x2)}" y="${Math.min(y,y2)}" width="${Math.abs(x2-x)}" height="${Math.abs(y2-y)}"/>`;
  else if(s.type==='line' || s.type==='arrow') {
   shape=`<line x1="${x}" y1="${y}" x2="${x2}" y2="${y2}"/>`;
   if(s.type==='arrow') {
    const a=Math.atan2(y2-y,x2-x),r=Math.min(30,Math.hypot(x2-x,y2-y)/2);
    shape+=`<polyline points="${x2-r*Math.cos(a-.5)},${y2-r*Math.sin(a-.5)} ${x2},${y2} ${x2-r*Math.cos(a+.5)},${y2-r*Math.sin(a+.5)}"/>`;
   }
  }else shape=`<polyline points="${(s.points||[]).map(p=>`${number(p[0])},${number(p[1])}`).join(' ')}"/>`;
  return `<g stroke="${color}">${shape}</g>`;
 }).join('');
 return shapes ? `<svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Problem annotations"><g fill="none" stroke-width="4" opacity="0.5">${shapes}</g></svg>` : '';
}

export function buildOfflineLocation(location, date=new Date(), mapHtml='') {
 const files=[],paths=new Map();
 const all=[...(location.photos||[]),...location.boulders.flatMap(b=>[...(b.images||[]),...(b.videos||[])])];
 for(const media of all) {
  if(paths.has(media.url))continue;
  const ref=mediaReference(media.url);
  if(!ref)throw Object.assign(new Error('A location file has an invalid reference.'),{status:400});
  const name=`media/${String(files.length+1).padStart(3,'0')}.${ref.path.split('.').pop()}`;
  paths.set(media.url,name);files.push({name,path:ref.path});
 }
 const photos=(items,marks={})=>items.length ? `<div class="gallery">${items.map(m=>`<figure><div class="photo"><img src="${paths.get(m.url)}" alt="${esc(m.name)}" loading="lazy">${annotations(marks[m.id])}</div><figcaption><a href="${paths.get(m.url)}">${esc(m.name)}</a>${m.caption?`<p class="notes">${esc(m.caption)}</p>`:''}${credit(m)}</figcaption></figure>`).join('')}</div>` : '<p class="muted">No photos.</p>';
 const videos=items=>items.length ? `<div class="gallery">${items.map(m=>`<figure><video src="${paths.get(m.url)}" controls playsinline preload="none" aria-label="${esc(m.name)}"></video><figcaption><strong>${esc(m.name)}</strong> <a href="${paths.get(m.url)}">Open video file</a>${credit(m)}</figcaption></figure>`).join('')}</div>` : '<p class="muted">No videos.</p>';
 const links=(location.links||[]).map(l=>{
  try {const url=new URL(l.url);if(!['http:','https:'].includes(url.protocol))return '';}
  catch{return '';}
  return `<li><a href="${esc(l.url)}" rel="noreferrer">${esc(l.label)}</a><span class="muted"> ${esc(l.url)}</span></li>`;
 }).join('');
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(location.name)} | SideProj offline</title><style>
 *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f2f1e9;color:#23382c;font:16px/1.6 system-ui,sans-serif;overflow-wrap:anywhere}header,main,footer{max-width:1000px;margin:auto;padding:24px}header{background:#294e3e;color:white;border-radius:0 0 20px 20px}h1{font-size:clamp(28px,6vw,48px);line-height:1.2}h2,h3{line-height:1.3}a{color:inherit;text-underline-offset:3px}nav{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0}nav a,.back{display:inline-block;padding:8px 14px;border:1px solid #81968b;border-radius:8px;text-decoration:none}article{margin:28px 0;background:#fff;padding:clamp(16px,4vw,30px);border:1px solid #d5ddd6;border-radius:16px;scroll-margin-top:16px}.problem{background:#f3f6ef;margin-top:24px;padding:20px;border-radius:12px}.notes{white-space:pre-wrap}.credit,.muted{font-size:14px;opacity:.8}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:16px}figure{margin:0;min-width:0;background:#e8eee8;border-radius:10px;overflow:hidden}figcaption{padding:12px}img,video{display:block;width:100%;height:auto}video{max-height:550px;background:#15271e}.photo{position:relative}.photo svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}li{margin:10px 0}footer{text-align:center}.badge{font-size:12px;letter-spacing:2px;text-transform:uppercase}.summary{border-left:4px solid #92a979;padding-left:16px}@media print{nav,.back{display:none}article{break-inside:avoid}body{background:white}}
 </style></head><body><header id="top"><div class="badge">△ SideProj · Offline guide</div><h1>${esc(location.name)}</h1>${credit(location)}<p>Saved ${esc(date.toLocaleString('en-GB',{timeZone:'UTC'}))} UTC</p><p>${location.boulders.length} boulders · ${location.boulders.reduce((n,b)=>n+(b.problems||[]).length,0)} problems · ${files.length} files</p></header><main>
 <p class="summary">Photos, annotations and videos are included in this folder. External links and online maps need internet. This is a saved copy and will not update automatically.</p>
 <p class="summary"><strong>Photos or videos not loading?</strong> Make sure you extracted the entire ZIP, then open the HTML file from the extracted folder.</p>
 <details><summary>Using this offline guide</summary><p>Extract the entire ZIP before opening ${esc(offlineFilename(location.name))}, and keep the media folder beside it. Opening the guide from inside the ZIP can prevent photos and videos from loading.</p><p>Videos are saved at their original quality. If a video will not play in your browser, use its Open video file link and a compatible player.</p><p>On phones, file apps vary in their support for HTML guides. Check the extracted guide on your device before travelling; you can also open photos and videos directly from the media folder.</p></details>
 <article><h2>Getting there</h2>${note('Coordinates',`${location.latitude}, ${location.longitude}`)}${mapHtml || '<p class="muted">The offline map was unavailable when this guide was downloaded. Coordinates are shown above.</p>'}${note('Approach notes',location.approach)}<h3>Parking &amp; approach photos</h3>${photos(location.photos||[])}</article>
 <h2>Boulders</h2><nav aria-label="Boulders">${location.boulders.map((b,i)=>`<a href="#boulder-${i}">${esc(b.name)}</a>`).join('')}</nav>
 ${location.boulders.map((b,i)=>`<article id="boulder-${i}"><div class="badge">Boulder</div><h2>${esc(b.name)}</h2>${credit(b)}${note('Finding the Boulder',b.notes)}${note('Other notes',b.otherNotes)}<h3>Photos</h3>${photos(b.images||[])}<h3>Beta videos</h3>${videos(b.videos||[])}<h3>Problems</h3><nav aria-label="Problems">${(b.problems||[]).map((p,j)=>`<a href="#problem-${i}-${j}">${esc(p.grade)} — ${esc(p.name)}</a>`).join('')}</nav>${(b.problems||[]).map((p,j)=>`<section class="problem" id="problem-${i}-${j}"><div class="badge">Problem</div><h3>${esc(p.grade)} — ${esc(p.name)}</h3>${credit(p)}${note('Description',p.description)}<h4>Photos &amp; topos</h4>${photos((b.images||[]).filter(m=>(p.imageIds||[]).includes(m.id)),p.photoAnnotations||{})}<h4>Beta videos</h4>${videos((b.videos||[]).filter(m=>(p.videoIds||[]).includes(m.id)))}<a class="back" href="#boulder-${i}">↑ ${esc(b.name)}</a></section>`).join('')}<p><a class="back" href="#top">↑ Location overview</a></p></article>`).join('')}
 <article><h2>Additional links &amp; books</h2><p class="muted">These external resources require internet.</p>${links?`<ul>${links}</ul>`:'<p>No additional links.</p>'}</article></main><footer>SideProj · ${esc(location.name)} · Saved for offline use</footer></body></html>`;
 return {html,files};
}

// ZIP64, STORE method: already-compressed images/video are streamed unchanged.
// ZIP64 keeps archives above 4 GB valid without buffering the whole download.
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;};
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n>>>0);return b;};
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const pack=(...b)=>Buffer.concat(b);
export async function* zipFiles(entries) {
 let offset=0n;const central=[];
 for await (const entry of entries) {
  if(!/^([a-zA-Z0-9 _-]{1,80}\.html|README\.txt|location\.json|media\/\d+\.(jpg|png|webp|mp4|webm|mov))$/.test(entry.name))throw Error('Unsafe archive path');
  const name=Buffer.from(entry.name),start=offset;
  const extra=pack(u16(1),u16(16),u64(0),u64(0));
  const header=pack(u32(0x04034b50),u16(45),u16(0x808),u16(0),u16(0),u16(33),u32(0),u32(0xffffffff),u32(0xffffffff),u16(name.length),u16(extra.length),name,extra);
  yield header;offset+=BigInt(header.length);
  let crc=0xffffffff,size=0n;
  for await(const chunk of entry.body) {
   const bytes=Buffer.from(chunk);size+=BigInt(bytes.length);
   if(entry.maxBytes && size>BigInt(entry.maxBytes))throw Error('Downloaded file exceeds its size limit');
   for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);
   yield bytes;offset+=BigInt(bytes.length);
  }
  if(entry.expectedBytes!==undefined && size!==BigInt(entry.expectedBytes))throw Error('Incomplete media download');
  crc=(crc^0xffffffff)>>>0;
  const descriptor=pack(u32(0x08074b50),u32(crc),u64(size),u64(size));yield descriptor;offset+=BigInt(descriptor.length);
  const ce=pack(u16(1),u16(24),u64(size),u64(size),u64(start));
  central.push(pack(u32(0x02014b50),u16(45),u16(45),u16(0x808),u16(0),u16(0),u16(33),u32(crc),u32(0xffffffff),u32(0xffffffff),u16(name.length),u16(ce.length),u16(0),u16(0),u16(0),u32(0),u32(0xffffffff),name,ce));
 }
 const directory=offset;
 for(const record of central){yield record;offset+=BigInt(record.length);}
 yield pack(u32(0x06064b50),u64(44),u16(45),u16(45),u32(0),u32(0),u64(central.length),u64(central.length),u64(offset-directory),u64(directory));
 yield pack(u32(0x07064b50),u32(0),u64(offset),u32(1));
 yield pack(u32(0x06054b50),u16(0),u16(0),u16(0xffff),u16(0xffff),u32(0xffffffff),u32(0xffffffff),u16(0));
}

export async function* locationArchive(location,storage,signal,mapHtml='') {
 const {html,files}=buildOfflineLocation(location,new Date(),mapHtml);
 yield {name:offlineFilename(location.name),body:[Buffer.from(html)]};
 yield {name:'README.txt',body:[Buffer.from(('SIDE PROJ OFFLINE GUIDE\n\nExtract the entire ZIP, then open index.html in a browser. Keep the media folder beside it. Photos and videos are included, not internet links. If a video cannot play in your browser, open its file from the media folder in a compatible player. Mobile file preview apps may not support the full HTML guide: test on your device before travelling. External links/maps still require internet.\n').replace('index.html',offlineFilename(location.name)))]};
 yield {name:'location.json',body:[Buffer.from(JSON.stringify({...location,offlineFiles:Object.fromEntries(files.map(f=>['/media/'+f.path,f.name]))},null,2))]};
 for(const file of files) {
  const response=await storage.download(file.path,signal);
  const size=Number(response.headers.get('content-length'));
  yield {name:file.name,body:response.body,maxBytes:104857600,...(response.headers.has('content-length')?{expectedBytes:size}:{})};
 }
}
