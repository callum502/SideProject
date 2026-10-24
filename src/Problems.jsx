import React from 'react';
import { CreatorLink } from './PublicProfile';

const grades = [
  '4',
  '5',
  '5+',
  '6A/6A+',
  '6B/6B+',
  '6C/6C+',
  '7A',
  '7A+',
  '7B/7B+',
  '7C',
  '7C+',
  '8A',
  '8A+',
  '8B',
  '8B+',
  '8C',
  '8C+',
  '9A',
  '9A+',
].map((font, i) => `V${i} (${font})`);

export const problemHref = (location, boulder, problem) =>
  `#${new URLSearchParams({ location, boulder, ...(problem ? { problem } : {}) })}`;

export function ProblemList({ loggedIds = new Set(), place, boulder, add, busy, guest }) {
  return (
    <section className="problems-section">
      <div className="section-heading photos-heading">
        <h3>
          Problems <span className="count">{(boulder.problems || []).length}</span>
        </h3>
        <button
          className="secondary small"
          title={guest ? 'Create an account to contribute' : undefined}
          aria-disabled={busy}
          onClick={() => {
            if (!busy) add();
          }}
        >
          + Add problem
        </button>
      </div>
      {boulder.problems?.length ? (
        <div className="problem-list">
          {boulder.problems.map(p => (
            <a className="problem-row problem-preview" key={p.id} href={problemHref(place.id, boulder.id, p.id)}>
              <span>
                <strong>
                  {p.grade} - {p.name}
                </strong>
                {loggedIds.has(p.id) && <span className="logged-badge">Done</span>}
                <p>{p.description}</p>
              </span>
              <MediaCounts problem={p} />
              <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      ) : (
        <p className="problem-empty">No problems yet. Add the first line on this boulder.</p>
      )}
    </section>
  );
}

// Small photo and video counts on a problem row, so climbers can see which problems have topos or beta.
function MediaCounts({ problem }) {
  const photos = problem.imageIds.length,
    videos = problem.videoIds.length;
  if (!photos && !videos) return <span />;
  const label = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  return (
    <span className="problem-media-counts">
      {photos > 0 && (
        <span title={label(photos, 'photo')}>
          <span aria-hidden="true">▧ {photos}</span>
          <span className="sr-only">{label(photos, 'photo')}</span>
        </span>
      )}
      {videos > 0 && (
        <span title={label(videos, 'video')}>
          <span aria-hidden="true">▶︎ {videos}</span>
          <span className="sr-only">{label(videos, 'video')}</span>
        </span>
      )}
    </span>
  );
}

// Problems on the boulder, other than `problem`, that use a photo or video.
export const otherProblemsUsing = (boulder, problem, item) =>
  (boulder.problems || []).filter(p => p.id !== problem?.id && [...p.imageIds, ...p.videoIds].includes(item.id));

export function ProblemForm({ problem, save, busy, error, cancel }) {
  // Text of only spaces passes the browser's required check, so say which field is missing.
  const [missing, setMissing] = React.useState('');
  async function submit(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const fields = {
      name: form.get('name').trim(),
      grade: form.get('grade').trim(),
      description: form.get('description').trim(),
      // Photos and videos are added on the problem page; editing keeps the ones already there.
      ...(problem ? {} : { imageIds: [], videoIds: [] }),
    };
    const empty = !fields.name
      ? ['name', 'Please enter a name.']
      : !fields.grade
        ? ['grade', 'Choose a grade.']
        : !fields.description
          ? ['description', 'Description is required.']
          : null;
    if (empty) {
      setMissing(empty[1]);
      e.currentTarget.querySelector(`[name=${empty[0]}]`).focus();
      return;
    }
    setMissing('');
    await save({ ...fields, id: problem?.id || crypto.randomUUID() });
  }
  const message = missing || error;
  return (
    <form onSubmit={submit}>
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
      <label>
        Problem name <span aria-hidden="true">*</span>
        <input name="name" required autoFocus maxLength={80} defaultValue={problem?.name || ''} />
      </label>
      <label>
        Grade <span aria-hidden="true">*</span>
        <select name="grade" required defaultValue={problem?.grade || ''}>
          <option value="" disabled>
            Select a grade
          </option>
          {problem?.grade && !grades.includes(problem.grade) && (
            <option value={problem.grade}>{problem.grade} (current)</option>
          )}
          {grades.map(grade => (
            <option key={grade} value={grade}>
              {grade}
            </option>
          ))}
        </select>
      </label>
      <label>
        Description <span aria-hidden="true">*</span>
        <textarea
          name="description"
          required
          maxLength={800}
          rows={5}
          placeholder="Describe the start, the holds, the moves and any other details such as overall style..."
          defaultValue={problem?.description || ''}
        />
      </label>
      <div className="form-actions">
        <button type="button" className="secondary" disabled={busy} onClick={cancel}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          {busy ? 'Saving...' : 'Save problem'}
        </button>
      </div>
    </form>
  );
}

export function ProblemPage({
  logged,
  logBusy,
  logError,
  logProblem,
  problem,
  boulder,
  edit,
  remove,
  busy,
  Shapes,
  navigation,
  canEdit,
  annotate,
  upload,
  uploadVideos,
  attach,
  removePhoto,
  removeVideo,
  guest,
}) {
  if (!problem)
    return (
      <div className="welcome">
        {navigation}
        <h2>Problem not found</h2>
        <p>Return to the boulder to choose another problem.</p>
      </div>
    );
  const images = boulder.images.filter(i => problem.imageIds.includes(i.id));
  const videos = (boulder.videos || []).filter(v => problem.videoIds.includes(v.id));
  // Videos from before videos moved to problem pages may not be on any problem; they can still be added to one.
  const unassignedVideos = (boulder.videos || []).filter(v => !otherProblemsUsing(boulder, null, v).length);
  return (
    <article className="problem-page">
      <div className="detail-banner problem-banner">
        {navigation}
        <div className="eyebrow">PROBLEM</div>
        <h1>
          {problem.grade} - {problem.name}
        </h1>
        <p className="created-by">
          Created by <CreatorLink item={problem} />
        </p>
        <div className="banner-bottom">
          <span>
            {images.length} {images.length === 1 ? 'photo' : 'photos'} · {videos.length}{' '}
            {videos.length === 1 ? 'video' : 'videos'}
          </span>
          {canEdit && (
            <div className="location-actions">
              <button disabled={busy || !canEdit} onClick={edit}>
                Edit problem
              </button>
              <button className="banner-remove" disabled={busy || !canEdit} onClick={remove}>
                Remove problem
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="problem-log-action">
        <button
          className="primary"
          title={guest ? 'Create an account to contribute' : undefined}
          aria-disabled={guest || logBusy}
          onClick={() => {
            if (!guest && !logBusy) logProblem();
          }}
        >
          {guest ? '+ Log problem' : logBusy ? 'Loading...' : logged ? '− Remove from logbook' : '+ Log problem'}
        </button>
        {logError && (
          <p className="error" role="alert">
            {logError}
          </p>
        )}
      </div>
      <div className="notes-block">
        <h3>Description</h3>
        <p className="preserve">{problem.description}</p>
      </div>
      <div className="section-heading photos-heading">
        <div>
          <h3>Photos & Topos</h3>
          <p>
            Annotate photos to show the holds and line. Photos of {boulder.name} can be reused by several problems, each
            with its own markings.
          </p>
        </div>
        {(canEdit || guest) && (
          <MediaDropdown
            guest={guest}
            label="+ Add Photo"
            busy={busy}
            accept="image/jpeg,image/png,image/webp"
            upload={upload}
            uploadText={
              <>
                Upload a new photo<small>JPEG, PNG, WebP · up to 8 MB each</small>
              </>
            }
            attach={() => attach('photo')}
            attachText={
              <>
                Reuse a photo from {boulder.name}
                <small>From the boulder page or its other problems</small>
              </>
            }
          />
        )}
      </div>
      {images.length ? (
        <div className="photo-grid">
          {images.map(image => (
            <figure className="problem-photo" key={image.id}>
              <div className="photo-thumb">
                <img src={image.url} alt={image.name} />
                <Shapes items={problem.photoAnnotations?.[image.id] || []} />
              </div>
              <figcaption>
                <a href={image.url} target="_blank" rel="noreferrer">
                  {image.name}
                </a>
                {canEdit && (
                  <div className="problem-media-actions">
                    <button className="secondary small" disabled={busy} onClick={() => annotate(image)}>
                      Annotate
                    </button>
                    <button className="remove-media" disabled={busy} onClick={() => removePhoto(image)}>
                      Remove photo
                    </button>
                  </div>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className="problem-empty">
          No photos yet. Upload a photo or reuse one from {boulder.name}, then annotate it for {problem.name}.
        </p>
      )}
      <div className="section-heading photos-heading">
        <div>
          <h3>Beta videos</h3>
          <p>Steal beta to become a better climber. MP4, WebM, or MOV · up to 100 MB each</p>
        </div>
        {(canEdit || guest) && (
          <MediaDropdown
            guest={guest}
            label={unassignedVideos.length ? '+ Add Video' : '+ Upload video'}
            busy={busy}
            accept="video/mp4,video/webm,video/quicktime,.mov"
            upload={uploadVideos}
            uploadText="Upload a new video"
            attach={unassignedVideos.length ? () => attach('video') : null}
            attachText={<>Add a video already on {boulder.name}</>}
          />
        )}
      </div>
      {videos.length ? (
        <div className="video-grid">
          {videos.map(video => (
            <figure className="video-card" key={video.id}>
              <video controls playsInline preload="metadata" src={video.url} aria-label={video.name} />
              <figcaption>
                {video.name}
                <div className="video-actions">
                  <a href={`${video.url}?download=${encodeURIComponent(video.name)}`} download={video.name}>
                    Download
                  </a>
                  {canEdit && (
                    <button
                      className="remove-media"
                      disabled={busy}
                      aria-label={`Remove video ${video.name}`}
                      onClick={() => removeVideo(video)}
                    >
                      Remove video
                    </button>
                  )}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className="problem-empty">No videos yet. Upload a video showing how to climb {problem.name}.</p>
      )}
    </article>
  );
}

// Picks photos already on the boulder to reuse on a problem, grouped by where they came from. Videos can only be
// picked from those not on any problem yet.
export function AttachMediaForm({ locationId, boulder, problem, kind, busy, error, cancel, save }) {
  const photo = kind === 'photo',
    field = photo ? 'imageIds' : 'videoIds';
  const usedBy = item => otherProblemsUsing(boulder, problem, item);
  const available = (photo ? boulder.images : boulder.videos || []).filter(item => !problem[field].includes(item.id));
  const groups = photo
    ? [
        ['Boulder photos', available.filter(item => item.onBoulderPage !== false)],
        ['From other problems', available.filter(item => item.onBoulderPage === false && usedBy(item).length)],
        ['Not used anywhere', available.filter(item => item.onBoulderPage === false && !usedBy(item).length)],
      ]
    : [['Videos not on a problem yet', available.filter(item => !usedBy(item).length)]];
  const [selected, setSelected] = React.useState([]);
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        if (selected.length) save(field, selected);
      }}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {photo && (
        <p className="media-picker-intro">
          The photo is shared, but your markings are saved for {problem.name} only. Other problems using it keep their
          own.
        </p>
      )}
      {groups
        .filter(([, items]) => items.length)
        .map(([legend, items]) => (
          <fieldset className="media-picker" key={legend}>
            <legend>{legend}</legend>
            {items.map(item => {
              const others = usedBy(item);
              return (
                <div key={item.id} className={photo ? undefined : 'video-picker-item'}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={busy}
                      aria-describedby={others.length ? `used-${item.id}` : undefined}
                      checked={selected.includes(item.id)}
                      onChange={e =>
                        setSelected(old => (e.target.checked ? [...old, item.id] : old.filter(id => id !== item.id)))
                      }
                    />
                    {photo && <img src={item.url} alt="" />}
                    <span>
                      {item.name}
                      {others.length > 0 && (
                        <small id={`used-${item.id}`} aria-hidden="true" className="media-picker-usage">
                          Used on {others.map(p => p.name).join(', ')}
                        </small>
                      )}
                    </span>
                  </label>
                  {!photo && <VideoPickerPreview item={item} />}
                </div>
              );
            })}
          </fieldset>
        ))}
      {!groups.some(([, items]) => items.length) && (
        <p>
          No other photos on {boulder.name} yet. Upload a new photo instead, or add photos of the boulder on the{' '}
          <a href={problemHref(locationId, boulder.id)} onClick={cancel}>
            {boulder.name}
          </a>{' '}
          page.
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="secondary" disabled={busy} onClick={cancel}>
          Cancel
        </button>
        <button className="primary" disabled={busy || !selected.length}>
          {busy ? 'Adding...' : 'Add selected'}
        </button>
      </div>
    </form>
  );
}

// Button to upload new media to a problem. With `attach`, it opens a menu that can also add existing boulder media.
function MediaDropdown({ label, busy, accept, upload, uploadText, attach, attachText, guest }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const outside = e => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const escape = e => {
      if (e.key === 'Escape') {
        setOpen(false);
        ref.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  if (!attach)
    return (
      <label
        title={guest ? 'Create an account to contribute' : undefined}
        className={`secondary small upload photo-dropdown ${busy || guest ? 'disabled' : ''}`}
      >
        {label}
        <input type="file" accept={accept} multiple disabled={busy || guest} onChange={upload} />
      </label>
    );
  return (
    <div className="photo-dropdown" ref={ref}>
      <button
        title={guest ? 'Create an account to contribute' : undefined}
        className="secondary small"
        aria-disabled={busy || guest}
        aria-expanded={open}
        onClick={() => {
          if (!busy && !guest) setOpen(!open);
        }}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="photo-dropdown-options">
          <label className="secondary upload">
            {uploadText}
            <input
              type="file"
              accept={accept}
              multiple
              disabled={busy}
              onChange={e => {
                setOpen(false);
                upload(e);
              }}
            />
          </label>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              attach();
            }}
          >
            {attachText}
          </button>
        </div>
      )}
    </div>
  );
}

// Not every browser can preview every video format; a video that can't be previewed can still be chosen.
function VideoPickerPreview({ item }) {
  const [failed, setFailed] = React.useState(false);
  return failed ? (
    <p>Preview unavailable for this format. You can still select this video.</p>
  ) : (
    <video
      className="video-picker-preview"
      controls
      playsInline
      preload="metadata"
      src={item.url}
      aria-label={`Preview ${item.name}`}
      onError={() => setFailed(true)}
    />
  );
}
