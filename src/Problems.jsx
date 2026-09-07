import React from 'react';

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
    <label>Problem name<input name="name" required autoFocus maxLength={120} defaultValue={problem?.name || ''}/></label>
    <label>Grade<input name="grade" required maxLength={40} placeholder="e.g. 6A or V3" defaultValue={problem?.grade || ''}/></label>
    <label>Description<textarea name="description" required maxLength={10000} rows={5} placeholder="Describe the start, the line, key moves, and finish..." defaultValue={problem?.description || ''}/></label>
    <fieldset className="media-picker"><legend>Link photos from this boulder</legend>{boulder.images.length ? boulder.images.map(image => <label key={image.id}><input type="checkbox" name="imageIds" value={image.id} defaultChecked={problem?.imageIds.includes(image.id)}/><img src={image.url} alt=""/><span>{image.name}</span></label>) : <p>Upload photos on the boulder page to link them here.</p>}</fieldset>
    <fieldset className="media-picker"><legend>Link beta videos from this boulder</legend>{boulder.videos?.length ? boulder.videos.map(video => <label key={video.id}><input type="checkbox" name="videoIds" value={video.id} defaultChecked={problem?.videoIds.includes(video.id)}/><span>{video.name}</span></label>) : <p>Upload videos on the boulder page to link them here.</p>}</fieldset>
    <div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={cancel}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save problem'}</button></div>
  </form>;
}

export function ProblemPage({ problem, boulder, edit, remove, busy, Shapes }) {
  if (!problem) return <div className="welcome"><h2>Problem not found</h2><p>Return to the boulder to choose another problem.</p></div>;
  const images = boulder.images.filter(i => problem.imageIds.includes(i.id));
  const videos = (boulder.videos || []).filter(v => problem.videoIds.includes(v.id));
  return <article className="problem-page"><div className="detail-banner problem-banner"><div className="eyebrow">PROBLEM</div><h1>{problem.grade} - {problem.name}</h1><div className="banner-bottom"><span>{images.length} {images.length === 1 ? 'photo' : 'photos'} · {videos.length} {videos.length === 1 ? 'video' : 'videos'}</span><div className="location-actions"><button disabled={busy} onClick={edit}>Edit problem</button><button className="banner-remove" disabled={busy} onClick={remove}>Remove problem</button></div></div></div>
    <div className="notes-block"><h3>Description</h3><p className="preserve">{problem.description}</p></div>
    <div className="photos-heading"><h3>Photos & Topos</h3></div>{images.length ? <div className="photo-grid">{images.map(image => <figure className="problem-photo" key={image.id}><div className="photo-thumb"><img src={image.url} alt={image.name}/><Shapes items={image.annotations}/></div><figcaption><a href={image.url} target="_blank" rel="noreferrer">{image.name}</a></figcaption></figure>)}</div> : <p className="problem-empty">No photos linked yet.</p>}
    <div className="photos-heading"><h3>Beta videos</h3></div>{videos.length ? <div className="video-grid">{videos.map(video => <figure className="video-card" key={video.id}><video controls playsInline preload="metadata" src={video.url} aria-label={video.name}/><figcaption>{video.name}<a href={video.url} download={video.name}>Download</a></figcaption></figure>)}</div> : <p className="problem-empty">No videos linked yet.</p>}
  </article>;
}
