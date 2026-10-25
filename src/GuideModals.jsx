import React from 'react';
import { validLocationLinks } from '../shared/location-links.mjs';
import { duplicateMediaName } from '../shared/media-names.mjs';
import { ProblemForm, AttachMediaForm, otherProblemsUsing } from './Problems';
import CoordinatePicker from './CoordinatePicker';
import AnnotationEditor from './AnnotationEditor';
import LocationLinksForm from './LocationLinksForm';
import { Modal } from './ui';

// The guide's dialogs: adding and editing locations, boulders and problems, naming uploads, captions, links,
// annotations, and confirming removals. `modal` says which is open; `actions` (from guideActions) makes the edits.
export default function GuideModals({
  modal,
  setModal,
  busy,
  error,
  setError,
  setToast,
  db,
  save,
  place,
  boulder,
  problem,
  user,
  canEdit,
  choose,
  goHome,
  actions,
}) {
  const {
    updatePlace,
    updateBoulder,
    updateProblems,
    deletesWithProblem,
    submit,
    uploadNamedPhotos,
    uploadNamedVideos,
  } = actions;
  return (
    <>
      {modal?.locationLinks && (
        <Modal
          title="Additional links"
          close={() => {
            if (!busy) {
              setError('');
              setModal(null);
            }
          }}
        >
          <LocationLinksForm
            links={place.links || []}
            busy={busy}
            error={error}
            cancel={() => {
              setError('');
              setModal(null);
            }}
            save={async links => {
              if (!validLocationLinks(links)) {
                setError('Each link needs a label and a valid HTTP or HTTPS URL.');
                return;
              }
              if (await updatePlace({ links })) setModal(null);
            }}
          />
        </Modal>
      )}
      {modal?.locationCaption && (
        <Modal
          title="Edit caption"
          close={() => {
            if (!busy) {
              setError('');
              setModal(null);
            }
          }}
        >
          <form
            onSubmit={async e => {
              e.preventDefault();
              const caption = new FormData(e.currentTarget).get('caption').trim();
              if (
                await updatePlace({
                  photos: place.photos.map(p => (p.id === modal.locationCaption.id ? { ...p, caption } : p)),
                })
              )
                setModal(null);
            }}
          >
            <label>
              Caption (optional)
              <textarea name="caption" rows="4" maxLength={2000} defaultValue={modal.locationCaption.caption || ''} />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button className="primary" disabled={busy}>
                Save caption
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal?.removeLocationPhoto && (
        <Modal
          title="Remove location photo?"
          close={() => {
            if (!busy) {
              setError('');
              setModal(null);
            }
          }}
        >
          <p>Remove {modal.removeLocationPhoto.name} from this location?</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setError('');
                setModal(null);
              }}
            >
              Cancel
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={async () => {
                if (await updatePlace({ photos: place.photos.filter(p => p.id !== modal.removeLocationPhoto.id) }))
                  setModal(null);
              }}
            >
              Remove photo
            </button>
          </div>
        </Modal>
      )}
      {modal?.nameUploads && (
        <Modal
          title={modal.nameUploads.kind === 'photo' ? 'Name your photo' : 'Name your video'}
          close={() => {
            if (!busy) {
              setError('');
              setModal(null);
            }
          }}
        >
          <form
            onSubmit={e => {
              e.preventDefault();
              const names = new FormData(e.currentTarget).getAll('mediaName').map(name => name.trim());
              if (names.some(name => !name)) {
                setError('Enter a name for each file.');
                return;
              }
              const { files, kind } = modal.nameUploads;
              const duplicate = duplicateMediaName(
                kind === 'photo' ? (boulder ? boulder.images : place.photos || []) : boulder.videos || [],
                names
              );
              if (duplicate !== null) {
                setError(`A ${kind} named "${duplicate}" already exists for this boulder. Choose a different name.`);
                return;
              }
              (kind === 'photo' ? uploadNamedPhotos : uploadNamedVideos)(
                files,
                names,
                new FormData(e.currentTarget).getAll('caption').map(value => value.trim())
              );
            }}
          >
            {modal.nameUploads.files.map((_, index) => (
              <label key={index}>
                <input
                  aria-label={`${modal.nameUploads.kind === 'photo' ? 'Photo' : 'Video'} ${index + 1} name`}
                  autoFocus={index === 0}
                  name="mediaName"
                  required
                  maxLength={255}
                  disabled={busy}
                  defaultValue={modal.nameUploads.names[index]}
                />
                {!boulder && (
                  <>
                    <span>Caption (optional)</span>
                    <textarea
                      name="caption"
                      rows="3"
                      maxLength={2000}
                      disabled={busy}
                      placeholder="Describe the parking spot, path, or landmark shown."
                    />
                  </>
                )}
              </label>
            ))}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setError('');
                  setModal(null);
                }}
              >
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal?.removeFromProblem &&
        (() => {
          const { removeFromProblem: item, field } = modal;
          const noun = field === 'imageIds' ? 'photo' : 'video';
          const deletes = deletesWithProblem(item, problem);
          return (
            <Modal
              title={deletes ? `Remove ${noun}?` : `Remove ${noun} from problem?`}
              close={() => {
                if (!busy) setModal(null);
              }}
            >
              <p>
                Remove <strong>{item.name}</strong> from this problem?{' '}
                {deletes
                  ? `No other problem${noun === 'photo' ? ' or the boulder page' : ''} uses it, so it will be deleted. This cannot be undone.`
                  : `The ${noun} stays on ${boulder.name} for other problems to use.`}
              </p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="form-actions">
                <button className="secondary" disabled={busy} onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button
                  className="danger-button"
                  disabled={busy || !canEdit(problem)}
                  onClick={async () => {
                    if (
                      await updateProblems(
                        boulder.problems.map(p =>
                          p.id === problem.id ? { ...p, [field]: p[field].filter(id => id !== item.id) } : p
                        )
                      )
                    ) {
                      setModal(null);
                      setToast(
                        (noun === 'photo' ? 'Photo' : 'Video') + (deletes ? ' removed' : ' removed from problem')
                      );
                    }
                  }}
                >
                  {busy ? 'Removing...' : `Remove ${noun}`}
                </button>
              </div>
            </Modal>
          );
        })()}
      {modal?.removeBoulder && (
        <Modal
          title="Remove boulder?"
          close={() => {
            if (!busy) setModal(null);
          }}
        >
          <p className="preserve">
            Remove <strong>{modal.removeBoulder.name}</strong> and all its problems, photos, annotations, and beta
            videos from the guide? This cannot be undone.
          </p>
          {user?.role !== 'admin' && <p>You can only remove this boulder if all its submissions are yours.</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button className="secondary" disabled={busy} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="danger-button"
              disabled={busy || !canEdit(modal.removeBoulder)}
              onClick={async () => {
                const id = modal.removeBoulder.id;
                if (await updatePlace({ boulders: place.boulders.filter(b => b.id !== id) })) {
                  setModal(null);
                  choose(place.id);
                  setToast('Boulder removed');
                }
              }}
            >
              {busy ? 'Removing...' : 'Remove boulder'}
            </button>
          </div>
        </Modal>
      )}
      {modal?.removeProblem && (
        <Modal
          title="Remove problem?"
          close={() => {
            if (!busy) setModal(null);
          }}
        >
          <p className="preserve">
            Remove <strong>{modal.removeProblem.name}</strong> from this boulder? This cannot be undone.{' '}
            {[...boulder.images, ...(boulder.videos || [])].some(item => deletesWithProblem(item, modal.removeProblem))
              ? 'Its videos and photos that no other problem or the boulder page uses will be deleted too.'
              : ''}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button className="secondary" disabled={busy} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={async () => {
                const id = modal.removeProblem.id;
                if (await updateProblems((boulder.problems || []).filter(p => p.id !== id))) {
                  setModal(null);
                  choose(place.id, boulder.id);
                  setToast('Problem removed');
                }
              }}
            >
              {busy ? 'Removing...' : 'Remove problem'}
            </button>
          </div>
        </Modal>
      )}
      {modal?.attachMedia && (
        <Modal
          title={
            modal.attachMedia === 'photo' ? `Reuse a photo from ${boulder.name}` : `Add a video from ${boulder.name}`
          }
          close={() => {
            if (!busy) setModal(null);
          }}
        >
          <AttachMediaForm
            locationId={place.id}
            boulder={boulder}
            problem={problem}
            kind={modal.attachMedia}
            busy={busy}
            error={error}
            cancel={() => setModal(null)}
            save={async (field, ids) => {
              if (
                await updateBoulder({
                  problems: boulder.problems.map(p =>
                    p.id === problem.id ? { ...p, [field]: [...new Set([...p[field], ...ids])] } : p
                  ),
                })
              )
                setModal(null);
            }}
          />
        </Modal>
      )}
      {modal?.problemForm && (
        <Modal
          title={modal.problem ? 'Edit problem' : 'Add problem'}
          close={() => {
            if (!busy) setModal(null);
          }}
        >
          <ProblemForm
            problem={modal.problem}
            busy={busy}
            error={error}
            cancel={() => setModal(null)}
            save={async item => {
              const problems = modal.problem
                ? boulder.problems.map(p => (p.id === item.id ? { ...p, ...item } : p))
                : [...(boulder.problems || []), item];
              if (await updateBoulder({ problems })) {
                setModal(null);
                choose(place.id, boulder.id, item.id);
              }
            }}
          />
        </Modal>
      )}
      {typeof modal === 'string' && (
        <Modal
          title={
            modal === 'location'
              ? 'Create a location'
              : modal === 'editLocation'
                ? 'Edit location'
                : modal === 'boulder'
                  ? 'Add a boulder'
                  : 'Edit boulder'
          }
          close={() => {
            if (!busy) setModal(null);
          }}
        >
          <form onSubmit={submit}>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {modal.toLowerCase().includes('location') ? (
              <>
                <label>
                  Location name <span aria-hidden="true">*</span>
                  <input
                    autoFocus
                    name="name"
                    required
                    maxLength={80}
                    defaultValue={modal === 'editLocation' ? place.name : ''}
                    placeholder="Fontainebleau"
                  />
                </label>
                <CoordinatePicker
                  initialLatitude={modal === 'editLocation' ? place.latitude : ''}
                  initialLongitude={modal === 'editLocation' ? place.longitude : ''}
                />
                <label>
                  Approach notes <span aria-hidden="true">*</span>
                  <textarea
                    required
                    name="approach"
                    rows="5"
                    maxLength={10000}
                    defaultValue={modal === 'editLocation' ? place.approach : ''}
                    placeholder="Where to park, how to get there, and what to know about access. You can include links to Google Maps Street View images to help show the parking or approach."
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Boulder name <span aria-hidden="true">*</span>
                  <input
                    autoFocus
                    name="name"
                    required
                    maxLength={80}
                    defaultValue={modal === 'editBoulder' ? boulder.name : ''}
                    placeholder="e.g. The Pebble"
                  />
                </label>
                <label>
                  Finding the Boulder <span aria-hidden="true">*</span>
                  <textarea
                    required
                    name="notes"
                    rows="7"
                    maxLength={800}
                    defaultValue={modal === 'editBoulder' ? boulder.notes : ''}
                    placeholder="From the end of the location approach, describe the path, landmarks, and distances to this boulder…"
                  />
                </label>
                <label>
                  Other Notes
                  <textarea
                    name="otherNotes"
                    rows="4"
                    maxLength={800}
                    defaultValue={modal === 'editBoulder' ? boulder.otherNotes || '' : ''}
                    placeholder="Describe the rock type, recommended mat placement, whether access or climbing depends on the tide, and any other useful details."
                  />
                </label>
              </>
            )}
            <div className="form-actions">
              <button type="button" className="secondary" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save ' + (modal.toLowerCase().includes('location') ? 'location' : 'boulder')}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal?.removeLocation && (
        <Modal
          title="Remove location?"
          close={() => {
            if (!busy) setModal(null);
          }}
        >
          <p className="preserve">
            Remove <strong>{modal.removeLocation.name}</strong> from your guide? All of its boulders, notes, photos,
            annotations, and beta videos will also be removed from the guide. This cannot be undone.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button className="secondary" disabled={busy} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={async () => {
                const id = modal.removeLocation.id;
                if (await save({ ...db, locations: db.locations.filter(location => location.id !== id) }, id)) {
                  setModal(null);
                  goHome();
                  setToast('Location removed');
                }
              }}
            >
              {busy ? 'Removing...' : 'Remove location'}
            </button>
          </div>
        </Modal>
      )}
      {modal?.remove && (
        <Modal
          title="Remove image?"
          close={() => {
            if (!busy) setModal(null);
          }}
        >
          <p className="preserve">
            {otherProblemsUsing(boulder, null, modal.remove).length ? (
              <>
                Remove <strong>{modal.remove.name}</strong> from the boulder page? It stays on{' '}
                {otherProblemsUsing(boulder, null, modal.remove)
                  .map(p => p.name)
                  .join(', ')}{' '}
                with its markings.
              </>
            ) : (
              <>
                Remove <strong>{modal.remove.name}</strong> from this boulder? This cannot be undone.
              </>
            )}
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button className="secondary" disabled={busy} onClick={() => setModal(null)}>
              Cancel
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={async () => {
                // A photo problems still use only leaves the boulder page, so their topos keep working.
                const id = modal.remove.id;
                const used = otherProblemsUsing(boulder, null, modal.remove).length;
                if (
                  await updateBoulder({
                    images: used
                      ? boulder.images.map(image => (image.id === id ? { ...image, onBoulderPage: false } : image))
                      : boulder.images.filter(image => image.id !== id),
                  })
                ) {
                  setModal(null);
                  setToast('Image removed');
                }
              }}
            >
              {busy ? 'Removing...' : 'Remove'}
            </button>
          </div>
        </Modal>
      )}
      {modal?.image && (
        <AnnotationEditor
          error={error}
          image={modal.image}
          close={() => {
            if (!busy) setModal(null);
          }}
          busy={busy}
          save={async annotations => {
            if (
              await updateBoulder({
                problems: boulder.problems.map(p =>
                  p.id === modal.problemId
                    ? { ...p, photoAnnotations: { ...p.photoAnnotations, [modal.image.id]: annotations } }
                    : p
                ),
              })
            )
              setModal(null);
          }}
        />
      )}
    </>
  );
}
