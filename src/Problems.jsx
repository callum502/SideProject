import React from 'react';

const grades = ['4','5','5+','6A/6A+','6B/6B+','6C/6C+','7A','7A+','7B/7B+','7C','7C+','8A','8A+','8B','8B+','8C','8C+','9A','9A+'].map((font, i) => `V${i} (${font})`);

export const problemHref = (location, boulder, problem) => `#${new URLSearchParams({ location, boulder, ...(problem ? { problem } : {}) })}`;

export function ProblemList({ place, boulder, add, busy }) {
  return <section className="problems-section"><div className="section-heading photos-heading"><h3>Problems <span className="count">{(boulder.problems || []).length}</span></h3><button className="secondary small" disabled={busy} onClick={add}>+ Add problem</button></div>
    {boulder.problems?.length ? <div className="problem-list">{boulder.problems.map(p => <a className="problem-row" key={p.id} href={problemHref(place.id, boulder.id, p.id)}><span><strong>{p.grade} - {p.name}</strong><p>{p.description}</p></span><span aria-hidden="true">↗</span></a>)}</div> : <p className="problem-empty">No problems yet. Add the first line on this boulder.</p>}
  </section>;
}

export function ProblemForm({ boulder, problem, save, busy, error, cancel }) {
  async function submit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const fields = { name: form.get('name').trim(), grade: form.get('grade').trim(), description: form.get('description').trim(), imageIds: form.getAll('imageIds'), videoIds: form.getAll('videoIds') };
    if (!fields.name || !fields.grade || !fields.description) { e.currentTarget.querySelector(!fields.name ? '[name=name]' : !fields.grade ? '[name=grade]' : '[name=description]').focus(); return; }
    await save({ ...fields, id: problem?.id || crypto.randomUUID() });
  }
  return <form onSubmit={submit}>{error && <p className="error" role="alert">{error}</p>}
    <label>Problem name <span aria-hidden="true">*</span><input name="name" required autoFocus maxLength={120} defaultValue={problem?.name || ''}/></label>
    <label>Grade <span aria-hidden="true">*</span><select name="grade" required defaultValue={problem?.grade || ''}><option value="" disabled>Select a grade</option>{problem?.grade && !grades.includes(problem.grade) && <option value={problem.grade}>{problem.grade} (current)</option>}{grades.map(grade => <option key={grade} value={grade}>{grade}</option>)}</select></label>
    <label>Description <span aria-hidden="true">*</span><textarea name="description" required maxLength={10000} rows={5} placeholder="Describe the start, the line, key moves, and finish..." defaultValue={problem?.description || ''}/></label>
    {problem && <>
    <fieldset className="media-picker"><legend>Link photos from this boulder</legend>{boulder.images.length ? boulder.images.map(image => <label key={image.id}><input type="checkbox" name="imageIds" value={image.id} defaultChecked={problem?.imageIds.includes(image.id)}/><img src={image.url} alt=""/><span>{image.name}</span></label>) : <p>Upload photos on the boulder page to link them here.</p>}</fieldset>
    <fieldset className="media-picker"><legend>Link beta videos from this boulder</legend>{boulder.videos?.length ? boulder.videos.map(video => <label key={video.id}><input type="checkbox" name="videoIds" value={video.id} defaultChecked={problem?.videoIds.includes(video.id)}/><span>{video.name}</span></label>) : <p>Upload videos on the boulder page to link them here.</p>}</fieldset>
    </>}
    <div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={cancel}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save problem'}</button></div>
  </form>;
}

export function ProblemPage({ problem, boulder, edit, remove, busy, Shapes, navigation, canEdit, annotate, upload, uploadVideos, attach, removePhoto }) {
  if (!problem) return <div className="welcome">{navigation}<h2>Problem not found</h2><p>Return to the boulder to choose another problem.</p></div>;
  const images = boulder.images.filter(i => problem.imageIds.includes(i.id));
  const videos = (boulder.videos || []).filter(v => problem.videoIds.includes(v.id));
  return <article className="problem-page"><div className="detail-banner problem-banner">{navigation}<div className="eyebrow">PROBLEM</div><h1>{problem.grade} - {problem.name}</h1><p className="created-by">Created by {problem.createdByName || problem.createdBy || 'Climber'}</p><div className="banner-bottom"><span>{images.length} {images.length === 1 ? 'photo' : 'photos'} · {videos.length} {videos.length === 1 ? 'video' : 'videos'}</span><div className="location-actions"><button disabled={busy || !canEdit} onClick={edit}>Edit problem</button><button className="banner-remove" disabled={busy || !canEdit} onClick={remove}>Remove problem</button></div></div></div>
    <div className="notes-block"><h3>Description</h3><p className="preserve">{problem.description}</p></div>
    <div className="section-heading photos-heading"><div><h3>Photos & Topos</h3><p>JPEG, PNG, WebP · up to 8 MB each</p></div>{canEdit && <MediaDropdown kind="photo" busy={busy} upload={upload} attach={() => attach('photo')} boulder={boulder} problem={problem}/>}</div>{images.length ? <div className="photo-grid">{images.map(image => <figure className="problem-photo" key={image.id}><div className="photo-thumb"><img src={image.url} alt={image.name}/><Shapes items={problem.photoAnnotations?.[image.id] || []}/></div><figcaption><a href={image.url} target="_blank" rel="noreferrer">{image.name}</a>{canEdit && <div className="problem-media-actions"><button className="secondary small" disabled={busy} onClick={() => annotate(image)}>Annotate</button><button className="remove-media" disabled={busy} onClick={() => removePhoto(image)}>Remove photo</button></div>}</figcaption></figure>)}</div> : <p className="problem-empty">No photos yet. Add photos to annotate them for {problem.name}.</p>}
    <div className="section-heading photos-heading"><div><h3>Beta videos</h3><p>MP4, WebM, or MOV · up to 100 MB each</p></div>{canEdit && <MediaDropdown kind="video" busy={busy} upload={uploadVideos} attach={() => attach('video')} boulder={boulder} problem={problem}/>}</div>{videos.length ? <div className="video-grid">{videos.map(video => <figure className="video-card" key={video.id}><video controls playsInline preload="metadata" src={video.url} aria-label={video.name}/><figcaption>{video.name}<a href={`${video.url}?download=${encodeURIComponent(video.name)}`} download={video.name}>Download</a></figcaption></figure>)}</div> : <p className="problem-empty">No videos yet. Upload videos here or add existing videos from {boulder.name}.</p>}
  </article>;
}

export function AttachMediaForm({ locationId, boulder, problem, kind, busy, error, cancel, save }) {
  const photo = kind === 'photo', field = photo ? 'imageIds' : 'videoIds';
  const available = (photo ? boulder.images : boulder.videos || []).filter(item => !problem[field].includes(item.id));
  const [selected, setSelected] = React.useState([]);
  return <form onSubmit={e => { e.preventDefault(); if (selected.length) save(field, selected); }}>
    {error && <p className="error" role="alert">{error}</p>}
    <fieldset className="media-picker"><legend>Choose {photo ? 'photos' : 'videos'} from {boulder.name}</legend>
      {available.map(item => <div key={item.id} className={photo ? undefined : "video-picker-item"}><label><input type="checkbox" disabled={busy} checked={selected.includes(item.id)} onChange={e => setSelected(old => e.target.checked ? [...old, item.id] : old.filter(id => id !== item.id))}/>{photo && <img src={item.url} alt=""/>}<span>{item.name}</span></label>{!photo && <VideoPickerPreview item={item}/>}</div>)}
      {!available.length && <p>No {photo ? 'photos' : 'videos'} available. Upload {photo ? 'an image' : 'a video'} to <a href={problemHref(locationId, boulder.id)} onClick={cancel}>{boulder.name}</a> so it can be attached to {problem.name}.</p>}
    </fieldset>
    <div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={cancel}>Cancel</button><button className="primary" disabled={busy || !selected.length}>{busy ? 'Adding...' : 'Add selected'}</button></div>
  </form>;
}

function MediaDropdown({ kind, busy, upload, attach, boulder, problem }) {
  const photo = kind === 'photo';
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const outside = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const escape = e => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="photo-dropdown" ref={ref}>
    <button className="secondary small" disabled={busy} aria-expanded={open} onClick={() => setOpen(!open)}>+ Add {photo ? 'Photo' : 'Video'} <span aria-hidden="true">▾</span></button>
    {open && <div className="photo-dropdown-options"><label className="secondary upload">Upload {kind} from files<input type="file" accept={photo ? "image/jpeg,image/png,image/webp" : "video/mp4,video/webm,video/quicktime,.mov"} multiple disabled={busy} onChange={e => { setOpen(false); upload(e); }}/></label><button className="secondary" disabled={busy} onClick={() => { setOpen(false); attach(); }}>{photo ? <>Add photo from the {boulder.name} page</> : <>Add video from the {boulder.name} page</>}</button></div>}
  </div>;
}

function VideoPickerPreview({ item }) {
  const [failed, setFailed] = React.useState(false);
  return failed ? <p>Preview unavailable for this format. You can still select this video.</p> : <video className="video-picker-preview" controls playsInline preload="metadata" src={item.url} aria-label={`Preview ${item.name}`} onError={() => setFailed(true)} />;
}
