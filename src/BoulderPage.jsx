import React from 'react';
import { IMAGE_MAX_MB } from '../shared/media-limits.mjs';
import { CreatorLink } from './PublicProfile';
import { ProblemList } from './Problems';
import { Icon, countLabel } from './ui';

// A boulder's page: its banner, directions and notes, problems, and the photos that show the boulder.
export default function BoulderPage({
  place,
  boulder,
  user,
  busy,
  canEdit,
  upload,
  logs,
  setModal,
  setError,
  navigation,
}) {
  // Photos that show the boulder itself, as opposed to topos uploaded for one problem.
  const boulderPhotos = (boulder.images || []).filter(image => image.onBoulderPage !== false);
  return (
    <>
      <div className="detail-banner boulder-banner">
        {navigation}
        <div className="eyebrow">BOULDER</div>
        <h1>{boulder.name}</h1>
        <p className="created-by">
          Created by <CreatorLink item={boulder} />
        </p>
        <div className="banner-bottom">
          <span>
            {countLabel((boulder.problems || []).length, 'problem')} ·{' '}
            {countLabel(boulderPhotos.length, 'boulder photo')}
          </span>
          <div className="location-actions">
            {canEdit(boulder) && (
              <button
                disabled={busy || !canEdit(boulder)}
                onClick={() => {
                  setError('');
                  setModal('editBoulder');
                }}
              >
                Edit boulder
              </button>
            )}
            {canEdit(boulder) && (
              <button
                disabled={busy}
                onClick={() => {
                  setError('');
                  setModal({ removeBoulder: boulder });
                }}
              >
                Remove boulder
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="notes-block">
        <h3>Finding the Boulder</h3>
        <p className="preserve">
          {boulder.notes ||
            'Describe how to find this boulder after following the location approach notes. Include nearby landmarks, paths, and distances.'}
        </p>
      </div>
      {boulder.otherNotes && (
        <div className="notes-block">
          <h3>Other Notes</h3>
          <p className="preserve">{boulder.otherNotes}</p>
        </div>
      )}
      <ProblemList
        loggedIds={new Set(logs.map(entry => entry.problem_id))}
        guest={!user}
        place={place}
        boulder={boulder}
        busy={busy || !user}
        add={() => {
          setError('');
          setModal({ problemForm: true });
        }}
      />
      <div className="section-heading photos-heading">
        <div>
          <h3>Boulder photos</h3>
          <p>
            Show what {boulder.name} looks like so climbers can spot it. To mark a problem's holds or line, open the
            problem and add a topo there.
          </p>
        </div>
        <label
          title={!user ? 'Create an account to contribute' : undefined}
          className={`secondary small upload ${busy || !user ? 'disabled' : ''}`}
        >
          + Upload boulder photos
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy || !user}
            onChange={upload}
          />
        </label>
      </div>
      {!boulderPhotos.length ? (
        <div className="photo-empty">
          <Icon name="photo" />
          <h3>Show climbers what this boulder looks like.</h3>
          <p>
            A wide shot of the boulder or a photo of each face helps climbers recognise it. Photos for a single problem
            belong on that problem's page.
          </p>
          <span>JPEG, PNG, WebP · up to {IMAGE_MAX_MB} MB each</span>
        </div>
      ) : (
        <div className="photo-grid">
          {boulderPhotos.map(img => (
            <div className="photo-item" key={img.id}>
              <div className="photo-card">
                <div className="photo-thumb">
                  <img src={img.url} alt={img.name} loading="lazy" />
                </div>
                <div>
                  <span>{img.name}</span>
                </div>
              </div>
              {canEdit(img) && (
                <button
                  className="remove-media"
                  disabled={busy || !canEdit(img)}
                  aria-label={`Remove image ${img.name}`}
                  onClick={() => {
                    setError('');
                    setModal({ remove: img });
                  }}
                >
                  Remove image
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
