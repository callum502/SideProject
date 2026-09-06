import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { exportGuide } from './exportGuide';
import LocationMap from './LocationMap';
import LocationSearch from './LocationSearch';

const uid = () => crypto.randomUUID();
const symbols = { pin: '◎', mountain: '△', plus: '+', arrow: '↗', photo: '▧' };
function Icon({ name }) { return <span aria-hidden="true" className="icon">{symbols[name]}</span>; }
async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
function Modal({ title, children, close }) {
  const ref = useRef();
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === ref.current) close(); }}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close" onClick={close}>×</button></div>{children}</dialog>;
}
function App() {
  const [db, setDb] = useState({ revision: 0, locations: [] }), [loaded, setLoaded] = useState(false);
  const [locationId, setLocationId] = useState(null), [boulderId, setBoulderId] = useState(null);
  const [modal, setModal] = useState(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [toast, setToast] = useState('');
  useEffect(() => { api('/api/guide').then(data => { setDb(data); setLocationId(new URLSearchParams(location.hash.slice(1)).get('location')); setBoulderId(new URLSearchParams(location.hash.slice(1)).get('boulder')); setLoaded(true); }).catch(e => setError(e.message)); }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => {
    const navigate = () => { const params = new URLSearchParams(location.hash.slice(1)); setLocationId(params.get('location')); setBoulderId(params.get('boulder')); setModal(null); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const place = db.locations.find(l => l.id === locationId);
  const boulder = place?.boulders.find(b => b.id === boulderId);
  const choose = (l, b = null) => { setLocationId(l); setBoulderId(b); location.hash = new URLSearchParams({ location: l, ...(b ? { boulder: b } : {}) }); };
  async function save(next) {
    setBusy(true); setError('');
    try { const result = await api('/api/guide', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }); setDb(result); setToast('Changes saved'); return true; }
    catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  }
  const updatePlace = async patch => save({ ...db, locations: db.locations.map(l => l.id === place.id ? { ...l, ...patch } : l) });
  const updateBoulder = async patch => updatePlace({ boulders: place.boulders.map(b => b.id === boulder.id ? { ...b, ...patch } : b) });
  async function submit(e) {
    e.preventDefault(); const form = Object.fromEntries(new FormData(e.currentTarget));
    form.name = form.name.trim(); if (!form.name) { setError('Please enter a name.'); return; }
    if (modal === 'location' || modal === 'editLocation') {
      const latitude = form.latitude.trim(), longitude = form.longitude.trim();
      if (!!latitude !== !!longitude) { setError('Enter both latitude and longitude, or leave both blank.'); return; }
      const item = { id: uid(), boulders: [], ...form, latitude, longitude };
      const ok = modal === 'location' ? await save({ ...db, locations: [...db.locations, item] }) : await updatePlace(form);
      if (ok) { setModal(null); if (modal === 'location') choose(item.id); }
    } else {
      const item = { id: uid(), images: [], videos: [], ...form };
      const ok = modal === 'boulder' ? await updatePlace({ boulders: [...place.boulders, item] }) : await updateBoulder(form);
      if (ok) { setModal(null); if (modal === 'boulder') choose(place.id, item.id); }
    }
  }
  async function upload(e) {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    setBusy(true); setError('');
    try {
      const images = [];
      for (const file of files) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose JPEG, PNG, or WebP images.');
        if (file.size > 8 * 1024 * 1024) throw new Error('Each image must be smaller than 8 MB.');
        const result = await api('/api/images', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
        images.push({ id: uid(), name: file.name, url: result.url, annotations: [] });
      }
      await updateBoulder({ images: [...boulder.images, ...images] });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function uploadVideos(e) {
    const files = [...e.target.files]; e.target.value = ''; if (!files.length) return;
    setBusy(true); setError('');
    try {
      for (const file of files) {
        if (!['video/mp4', 'video/webm'].includes(file.type)) throw new Error('Choose MP4 or WebM videos.');
        if (file.size > 100 * 1024 * 1024) throw new Error('Each video must be smaller than 100 MB.');
      }
      const videos = [];
      for (const file of files) {
        const result = await api('/api/videos', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
        videos.push({ id: uid(), name: file.name, url: result.url });
      }
      await updateBoulder({ videos: [...(boulder.videos || []), ...videos] });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function share() {
    try { await navigator.clipboard.writeText(location.href); setToast('Link copied — opens on this local server'); } catch { setError('Could not copy the link. Copy the address from your browser.'); }
  }
  async function download() {
    setBusy(true); setError('');
    try { await exportGuide(place); setToast('Guide exported with photos and annotations'); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const home = !locationId;
  const goHome = () => { setLocationId(null); setBoulderId(null); location.hash = ''; };
  return <div className="app">
    <div className="workspace"><header className="topbar"><a className="brand" href="#" aria-label="SideProj home"><span className="brand-mark" aria-hidden="true">△</span> Side<span className="brand-light">Proj</span></a><span className="breadcrumbs"><a href="#" onClick={goHome}>Find locations</a>{place && <> / <a href={`#${new URLSearchParams({ location: place.id })}`} onClick={() => choose(place.id)}>{place.name}</a></>}{boulder && <> / {boulder.name}</>}</span><div className="header-actions"><button className="primary small" disabled={!loaded || busy} onClick={() => { setError(''); setModal('location'); }}>+ Create location</button>{place && <button className="secondary small" disabled={busy} onClick={download}>↓ Export guide</button>}<button className="secondary small" onClick={share}><Icon name="arrow"/> Copy local link</button></div></header>
    <main className={home ? "search-home" : "location-page"}>
    {error && <div role="alert" className="error">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {home ? <><LocationSearch locations={db.locations} loaded={loaded}/><LocationMap locations={db.locations} selectedId={null} onSelect={id => choose(id)}/></> : <><a className="back-to-search" href={boulder ? `#${new URLSearchParams({ location: place.id })}` : "#"}>← Back to {boulder ? place.name : 'search'}</a>
    <section id="location-details" className="detail-panel">{!place ? <div className="welcome"><h2>{loaded ? 'Location not found' : 'Loading location...'}</h2>{loaded && <p>This location may have been removed. Return to search to find another location.</p>}</div> : <>
    <div className="detail-banner"><div className="eyebrow"><Icon name="pin"/> {place.region || 'CLIMBING LOCATION'}</div><h2>{place.name}</h2><div className="banner-bottom"><span>{place.boulders.length} boulders · {place.boulders.reduce((s, b) => s + b.images.length, 0)} photos</span><div className="location-actions"><button onClick={() => { setError(''); setModal('editLocation'); }}>Edit location ↗</button><button disabled={busy} onClick={() => { setError(''); setModal({ removeLocation: place }); }}>Remove location</button></div></div></div>
    {boulder ? <><button className="back-link" onClick={() => choose(place.id)}>← All boulders</button><div className="boulder-heading"><div><div className="eyebrow">BOULDER BETA</div><h2>{boulder.name}</h2></div><button className="secondary small" onClick={() => setModal('editBoulder')}>Edit notes</button></div><div className="notes-block"><h3>Route notes</h3><p className="preserve">{boulder.notes || 'No route notes yet. Add grades, start holds, sequences, and landing beta.'}</p></div><div className="section-heading photos-heading"><div><h3>Photos & topos</h3><p>Open a photo to mark the line.</p></div><label className={`secondary small upload ${busy ? 'disabled' : ''}`}>+ Upload images<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={upload}/></label></div>{!boulder.images.length ? <div className="photo-empty"><Icon name="photo"/><h3>Make the beta visual.</h3><p>Upload a boulder photo, then draw red lines, boxes, or freehand marks.</p><span>JPEG, PNG, WebP · up to 8 MB each</span></div> : <div className="photo-grid">{boulder.images.map(img => <div className="photo-item" key={img.id}><button className="photo-card" onClick={() => setModal({ image: img })}><div className="photo-thumb"><img src={img.url} alt={img.name}/><Shapes items={img.annotations}/></div><div><span>{img.name}</span><strong>Annotate ↗</strong></div></button><button className="remove-media" disabled={busy} aria-label={`Remove image ${img.name}`} onClick={() => { setError(''); setModal({ remove: img, collection: 'images' }); }}>Remove image</button></div>)}</div>}
    <section aria-labelledby="beta-videos-heading"><div className="section-heading photos-heading"><div><h3 id="beta-videos-heading">Beta videos</h3><p>See the moves, from start to top-out.</p></div><label className={`secondary small upload ${busy ? 'disabled' : ''}`}>{busy ? 'Please wait...' : '+ Upload videos'}<input type="file" accept="video/mp4,video/webm" multiple disabled={busy} onChange={uploadVideos}/></label></div>
    <p className="video-hint">MP4 or WebM · up to 100 MB each</p>
    {!(boulder.videos || []).length ? <div className="photo-empty"><h3>Share the climbing beta.</h3><p>Upload a video showing the route, key moves, or your full send.</p></div> : <div className="video-grid">{boulder.videos.map(video => <figure className="video-card" key={video.id}><video controls playsInline preload="metadata" src={video.url} aria-label={video.name}>Your browser does not support this video.</video><figcaption>{video.name}<div className="video-actions"><a href={video.url} download={video.name}>Download</a><button className="remove-media" disabled={busy} aria-label={`Remove video ${video.name}`} onClick={() => { setError(''); setModal({ remove: video, collection: 'videos' }); }}>Remove video</button></div></figcaption><p>If playback is unavailable, download the original video.</p></figure>)}</div>}</section>
    </> : <><div className="location-info"><div><h3><Icon name="pin"/> Coordinates</h3>{place.latitude && place.longitude ? <><p className="coordinates">{Number(place.latitude).toFixed(5)}, {Number(place.longitude).toFixed(5)}</p><a target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.latitude},${place.longitude}`)}`}>Open in maps ↗</a></> : <button className="text-button" onClick={() => setModal('editLocation')}>+ Add coordinates</button>}</div><div><h3>Approach notes</h3><p className="preserve">{place.approach || 'Add parking details, the path to follow, and access information.'}</p></div></div><div className="section-heading boulders-heading"><div><h3>Boulders <span className="count">{place.boulders.length}</span></h3><p>The lines, the moves, the local knowledge.</p></div><button className="secondary small" onClick={() => setModal('boulder')}>+ Add boulder</button></div>{!place.boulders.length ? <div className="photo-empty"><Icon name="mountain"/><h3>A location full of possibilities.</h3><p>Add the first boulder to start collecting route beta and photos.</p></div> : <div className="boulder-list">{place.boulders.map((b, i) => <button className="boulder-row" key={b.id} onClick={() => choose(place.id, b.id)}><span className="boulder-avatar">{b.images[0] ? <img src={b.images[0].url} alt=""/> : <Icon name="mountain"/>}</span><div><span className="eyebrow">BOULDER {String(i + 1).padStart(2, '0')}</span><strong>{b.name}</strong><p>{b.notes || 'Add route notes and climbing beta'}</p></div><span className="boulder-meta">{b.images.length} photos</span><span>↗</span></button>)}</div>}</>}
    </>}</section></>}<footer>SideProj <span>A shared love of rock. A better way to remember it.</span></footer></main></div>
    {typeof modal === 'string' && <Modal title={modal === 'location' ? 'Create a location' : modal === 'editLocation' ? 'Edit location' : modal === 'boulder' ? 'Add a boulder' : 'Edit boulder'} close={() => setModal(null)}><form onSubmit={submit}>{error && <p className="error" role="alert">{error}</p>}{modal.toLowerCase().includes('location') ? <><label>Location name<input autoFocus name="name" required maxLength={120} defaultValue={modal === 'editLocation' ? place.name : ''} placeholder="e.g. Stanage Plantation"/></label><label>Region<input name="region" maxLength={120} defaultValue={modal === 'editLocation' ? place.region : ''} placeholder="e.g. Peak District, UK"/></label><div className="form-columns"><label>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" defaultValue={modal === 'editLocation' ? place.latitude : ''} placeholder="53.3470"/></label><label>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" defaultValue={modal === 'editLocation' ? place.longitude : ''} placeholder="-1.6330"/></label></div><label>Approach notes<textarea name="approach" rows="5" maxLength={10000} defaultValue={modal === 'editLocation' ? place.approach : ''} placeholder="Where to park, how to get there, and what to know about access…"/></label></> : <><label>Boulder name<input autoFocus name="name" required maxLength={120} defaultValue={modal === 'editBoulder' ? boulder.name : ''} placeholder="e.g. The Pebble"/></label><label>Route notes<textarea name="notes" rows="7" maxLength={10000} defaultValue={modal === 'editBoulder' ? boulder.notes : ''} placeholder="Route names and grades, starting holds, movement, landings…"/></label></>}<div className="form-actions"><button type="button" className="secondary" onClick={() => setModal(null)}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save '+ (modal.toLowerCase().includes('location') ? 'location' : 'boulder')}</button></div></form></Modal>}
    {modal?.removeLocation && <Modal title="Remove location?" close={() => { if (!busy) setModal(null); }}><p className="preserve">Remove <strong>{modal.removeLocation.name}</strong> from your guide? All of its boulders, notes, photos, annotations, and beta videos will also be removed from the guide. This cannot be undone.</p>{error && <p className="error" role="alert">{error}</p>}<div className="form-actions"><button className="secondary" disabled={busy} onClick={() => setModal(null)}>Cancel</button><button className="danger-button" disabled={busy} onClick={async () => { const id = modal.removeLocation.id; if (await save({ ...db, locations: db.locations.filter(location => location.id !== id) })) { setModal(null); goHome(); setToast('Location removed'); } }}>{busy ? 'Removing...' : 'Remove location'}</button></div></Modal>}
    {modal?.remove && <Modal title={modal.collection === 'images' ? 'Remove image?' : 'Remove video?'} close={() => { if (!busy) setModal(null); }}><p className="preserve">Remove <strong>{modal.remove.name}</strong> from this boulder?{modal.collection === 'images' ? ' Its annotations will also be removed.' : ''}</p>{error && <p className="error" role="alert">{error}</p>}<div className="form-actions"><button className="secondary" disabled={busy} onClick={() => setModal(null)}>Cancel</button><button className="danger-button" disabled={busy} onClick={async () => { const { collection, remove } = modal; if (await updateBoulder({ [collection]: (boulder[collection] || []).filter(item => item.id !== remove.id) })) { setModal(null); setToast(collection === 'images' ? 'Image removed' : 'Video removed'); } }}>{busy ? 'Removing...' : 'Remove'}</button></div></Modal>}
    {modal?.image && <AnnotationEditor error={error} image={modal.image} close={() => setModal(null)} busy={busy} save={async annotations => { if (await updateBoulder({ images: boulder.images.map(img => img.id === modal.image.id ? { ...img, annotations } : img) })) setModal(null); }}/>}<div className="toast" role="status">{toast}</div>
  </div>;
}
function Shapes({ items, draft, cursor, ...props }) {
  return <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" {...props}>{[...items, ...(draft ? [draft] : [])].map((s, i) => s.type === 'box' ? <rect key={i} x={Math.min(s.x, s.x2)} y={Math.min(s.y, s.y2)} width={Math.abs(s.x2 - s.x)} height={Math.abs(s.y2 - s.y)} /> : s.type === 'line' ? <line key={i} x1={s.x} y1={s.y} x2={s.x2} y2={s.y2}/> : <polyline key={i} points={s.points.map(p => p.join(',')).join(' ')}/>)}{cursor && <g stroke="white"><line x1={cursor[0]-15} y1={cursor[1]} x2={cursor[0]+15} y2={cursor[1]}/><line x1={cursor[0]} y1={cursor[1]-15} x2={cursor[0]} y2={cursor[1]+15}/></g>}</svg>;
}
function AnnotationEditor({ image, close, save, busy, error }) {
  const [items, setItems] = useState(image.annotations), [draft, setDraft] = useState(null), [tool, setTool] = useState('line');
  const drawing = useRef(null);
  const [cursor, setCursor] = useState([500, 500]), [keyboard, setKeyboard] = useState(false);
  function keyDraw(e) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(e.key)) return;
    e.preventDefault(); setKeyboard(true);
    if (e.key === 'Enter' || e.key === ' ') {
      if (drawing.current) { setItems(old => [...old, drawing.current]); drawing.current = null; setDraft(null); }
      else { const [x, y] = cursor; drawing.current = { type: tool, x, y, x2: x, y2: y, points: [[x, y]] }; setDraft(drawing.current); }
      return;
    }
    const step = e.shiftKey ? 50 : 10;
    const next = [Math.max(0, Math.min(1000, cursor[0] + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0))), Math.max(0, Math.min(1000, cursor[1] + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0)))];
    setCursor(next);
    if (drawing.current) { drawing.current = { ...drawing.current, x2: next[0], y2: next[1], points: [...drawing.current.points, next] }; setDraft(drawing.current); }
  }
  const point = e => { const r = e.currentTarget.getBoundingClientRect(); return [Math.max(0, Math.min(1000, (e.clientX - r.left) / r.width * 1000)), Math.max(0, Math.min(1000, (e.clientY - r.top) / r.height * 1000))]; };
  function start(e) { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); const [x, y] = point(e); drawing.current = { type: tool, x, y, x2: x, y2: y, points: [[x, y]] }; setDraft(drawing.current); }
  function move(e) { if (!drawing.current) return; const [x2, y2] = point(e); drawing.current = { ...drawing.current, x2, y2, points: [...drawing.current.points, [x2, y2]] }; setDraft(drawing.current); }
  function finish(e) { if (!drawing.current) return; move(e); const s = drawing.current; if (Math.abs(s.x2 - s.x) + Math.abs(s.y2 - s.y) > 2 || s.points.length > 3) setItems(old => [...old, s]); drawing.current = null; setDraft(null); }
  return <Modal title="Annotate photo" close={close}>{error && <p className="error" role="alert">{error}</p>}<div className="annotation-toolbar" role="group" aria-label="Drawing tools">{[['line', '╱ Line'], ['box', '□ Box'], ['freehand', '〰 Freehand']].map(([key, label]) => <button key={key} className={tool === key ? 'tool active' : 'tool'} aria-pressed={tool === key} onClick={() => setTool(key)}>{label}</button>)}<span className="red-dot"/><button className="tool" disabled={!items.length} onClick={() => setItems(items.slice(0, -1))}>↶ Undo</button><button className="tool" disabled={!items.length} onClick={() => setItems([])}>Clear</button></div><p className="annotation-help">Drag on the photo to draw. Or focus the photo, use arrow keys to move, and press Enter to start and finish a mark.</p><div className="annotation-stage"><img src={image.url} alt={image.name} draggable="false"/><Shapes items={items} draft={draft} cursor={keyboard ? cursor : null} tabIndex={0} onKeyDown={keyDraw} onBlur={() => setKeyboard(false)} onPointerDown={e => { setKeyboard(false); start(e); }} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { drawing.current = null; setDraft(null); }} aria-label="Photo annotation canvas"/></div><div className="form-actions"><button className="secondary" onClick={close}>Cancel</button><button className="primary" disabled={busy} onClick={() => save(items)}>{busy ? 'Saving…' : 'Save annotations'}</button></div></Modal>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);

