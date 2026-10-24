import { checkMediaCapacity } from '../media-limits.mjs';
import PublicProfile, { CreatorLink } from './PublicProfile';
import Friends from './Friends';
import UserMenu from './UserMenu';
import CompleteProfile from './CompleteProfile';
import { validLocationLinks } from '../location-links.mjs';
import { duplicateMediaName, normalizeMediaName } from '../media-names.mjs';
import { guideChanges } from '../guide-changes.mjs';
import { api } from './api';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

import LocationMap from './LocationMap';
import CoordinatePicker from './CoordinatePicker';
import LoginPage from './LoginPage';
import LocationSearch from './LocationSearch';
import PageNavigation from './PageNavigation';
import { ProblemList, ProblemForm, ProblemPage, AttachMediaForm, otherProblemsUsing } from './Problems';

const uid = () => crypto.randomUUID();
const countLabel = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const symbols = { pin: '◎', mountain: '△', plus: '+', arrow: '↗', photo: '▧' };
function Icon({ name }) {
  return (
    <span aria-hidden="true" className="icon">
      {symbols[name]}
    </span>
  );
}
// A native <dialog> shown modally. The page behind it is locked in place while open, and its scroll position is
// restored on close unless the dialog navigated somewhere else.
function Modal({ title, children, close }) {
  const ref = useRef();
  useEffect(() => {
    const dialog = ref.current,
      body = document.body,
      root = document.documentElement;
    const scrollX = window.scrollX,
      scrollY = window.scrollY,
      hash = location.hash;
    const properties = ['position', 'top', 'left', 'width', 'overflow'];
    const previous = Object.fromEntries(properties.map(key => [key, body.style[key]]));
    const overflow = root.style.overflow;
    body.style.position = 'fixed';
    body.style.top = -scrollY + 'px';
    body.style.left = -scrollX + 'px';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      Object.assign(body.style, previous);
      root.style.overflow = overflow;
      if (location.hash === hash) window.scrollTo(scrollX, scrollY);
    };
  }, []);
  // Escape does what the ✕ button does, through the dialog's own close handler (which stays open while saving),
  // instead of letting the browser close the <dialog> behind React's back.
  return (
    <dialog
      ref={ref}
      onCancel={e => {
        e.preventDefault();
        close();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
// The whole app. The page comes from the URL hash: #login, #friends, #logbook, #details, user=<id> for a public
// profile, and location=<id>&boulder=<id>&problem=<id> for the guide (search and map when none is set).
function App() {
  const videoMaxMB = 100;
  const [profileId, setProfileId] = useState(new URLSearchParams(location.hash.slice(1)).get('user'));
  const [friendsPage, setFriendsPage] = useState(location.hash === '#friends');
  const [logbookPage, setLogbookPage] = useState(location.hash === '#logbook');
  const [logs, setLogs] = useState([]),
    [logsLoading, setLogsLoading] = useState(false),
    [logsError, setLogsError] = useState(''),
    [logBusy, setLogBusy] = useState(false);

  const [detailsPage, setDetailsPage] = useState(location.hash === '#details');
  const [user, setUser] = useState(null),
    [loginPage, setLoginPage] = useState(!location.hash || location.hash === '#' || location.hash === '#login');
  // Load the logbook when the user signs in or opens the Logbook page. `active` drops replies from a previous user.
  useEffect(() => {
    let active = true;
    setLogs([]);
    setLogsError('');
    if (user) {
      setLogsLoading(true);
      api('/api/logbook')
        .then(rows => {
          if (active) setLogs(rows);
        })
        .catch(e => {
          if (active) setLogsError(e.message);
        })
        .finally(() => {
          if (active) setLogsLoading(false);
        });
    } else setLogsLoading(false);
    return () => {
      active = false;
    };
  }, [user?.id, logbookPage]);
  async function logProblem(id, completed) {
    setLogBusy(true);
    setLogsError('');
    try {
      setLogs(
        await api('/api/logbook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ problemId: id, completed }),
        })
      );
    } catch (e) {
      setLogsError(e.message);
    } finally {
      setLogBusy(false);
    }
  }
  // Users can edit what they created and admins can edit anything; the server enforces the same rule.
  const canEdit = item => !!user && (user.role === 'admin' || item?.createdBy === user.id);
  // Check the session on load and whenever the window regains focus, e.g. after logging out in another tab.
  useEffect(() => {
    const refresh = () =>
      api('/api/session')
        .then(data => setUser(data.user))
        .catch(() => setUser(null));
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const [db, setDb] = useState({ locations: [] }),
    [loaded, setLoaded] = useState(false);
  const [locationId, setLocationId] = useState(null),
    [boulderId, setBoulderId] = useState(null);
  const [problemId, setProblemId] = useState(null);
  const [modal, setModal] = useState(null),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [toast, setToast] = useState('');
  useEffect(() => {
    api('/api/guide')
      .then(data => {
        setDb(data);
        setLocationId(new URLSearchParams(location.hash.slice(1)).get('location'));
        setBoulderId(new URLSearchParams(location.hash.slice(1)).get('boulder'));
        setProblemId(new URLSearchParams(location.hash.slice(1)).get('problem'));
        setLoaded(true);
      })
      .catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  // Every page has its own hash, so links, Back and Forward all work.
  useEffect(() => {
    const navigate = () => {
      setFriendsPage(location.hash === '#friends');
      setLogbookPage(location.hash === '#logbook');
      setDetailsPage(location.hash === '#details');
      setLoginPage(!location.hash || location.hash === '#' || location.hash === '#login');
      const params = new URLSearchParams(location.hash.slice(1));
      setProfileId(params.get('user'));
      setLocationId(params.get('location'));
      setBoulderId(params.get('boulder'));
      setProblemId(params.get('problem'));
      setModal(null);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  const place = db.locations.find(l => l.id === locationId);
  const boulder = place?.boulders.find(b => b.id === boulderId);
  const problem = boulder?.problems?.find(p => p.id === problemId);
  // Photos that show the boulder itself, as opposed to topos uploaded for one problem.
  const boulderPhotos = (boulder?.images || []).filter(image => image.onBoulderPage !== false);
  const choose = (l, b = null, p = null) => {
    setLocationId(l);
    setBoulderId(b);
    setProblemId(p);
    location.hash = new URLSearchParams({ location: l, ...(b ? { boulder: b } : {}), ...(p ? { problem: p } : {}) });
  };
  async function logout() {
    try {
      await api('/api/logout', { method: 'POST' });
      setUser(null);
      setModal(null);
      location.hash = '#login';
    } catch (e) {
      setError(e.message);
    }
  }
  // Sends only the records that differ from the loaded guide; the server replies with the latest full guide.
  async function save(next) {
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/guide', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: guideChanges(db, next) }),
      });
      setDb(result);
      setToast('Changes saved');
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const updatePlace = async patch =>
    save({ ...db, locations: db.locations.map(l => (l.id === place.id ? { ...l, ...patch } : l)) });
  const updateBoulder = async patch => {
    const next = { ...boulder, ...patch };
    const onBoulder = id => next.images.some(i => i.id === id);
    // A removed photo also loses its links and its annotations on every problem.
    next.problems = (next.problems || []).map(p => ({
      ...p,
      imageIds: p.imageIds.filter(onBoulder),
      videoIds: p.videoIds.filter(id => (next.videos || []).some(v => v.id === id)),
      ...(p.photoAnnotations
        ? { photoAnnotations: Object.fromEntries(Object.entries(p.photoAnnotations).filter(([id]) => onBoulder(id))) }
        : {}),
    }));
    return updatePlace({ boulders: place.boulders.map(b => (b.id === boulder.id ? next : b)) });
  };
  // Problem photos and videos are only reachable through problems. A change to `problems` that leaves one off the
  // boulder page and on no problem also deletes it, when the user may, so it stops using storage.
  const orphaned = (item, problems) => {
    const uses = list => list.some(p => [...p.imageIds, ...p.videoIds].includes(item.id));
    return item.onBoulderPage !== true && canEdit(item) && uses(boulder.problems) && !uses(problems);
  };
  const updateProblems = problems =>
    updateBoulder({
      problems,
      images: boulder.images.filter(image => !orphaned(image, problems)),
      videos: (boulder.videos || []).filter(video => !orphaned(video, problems)),
    });
  // Whether taking `item` off `problem` deletes it (see updateProblems).
  const deletesWithProblem = (item, problem) =>
    orphaned(
      item,
      boulder.problems.filter(p => p.id !== problem.id)
    );
  // Submit handler shared by the add and edit forms for locations and boulders.
  async function submit(e) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget));
    for (const field of ['approach', 'notes'])
      if (field in form) {
        form[field] = form[field].trim();
        if (!form[field]) {
          setError(field === 'approach' ? 'Approach notes are required.' : 'Finding the Boulder is required.');
          return;
        }
      }
    form.name = form.name.trim();
    if (!form.name) {
      setError('Please enter a name.');
      return;
    }
    if (modal === 'location' || modal === 'editLocation') {
      const latitude = form.latitude.trim(),
        longitude = form.longitude.trim();
      if (!latitude || !longitude) {
        setError('Enter both latitude and longitude.');
        return;
      }
      const item = { id: uid(), boulders: [], ...form, latitude, longitude };
      const ok =
        modal === 'location' ? await save({ ...db, locations: [...db.locations, item] }) : await updatePlace(form);
      if (ok) {
        setModal(null);
        if (modal === 'location') choose(item.id);
      }
    } else {
      const item = { id: uid(), images: [], videos: [], problems: [], ...form };
      const ok =
        modal === 'boulder' ? await updatePlace({ boulders: [...place.boulders, item] }) : await updateBoulder(form);
      if (ok) {
        setModal(null);
        if (modal === 'boulder') choose(place.id, item.id);
      }
    }
  }
  // Gives each chosen file an unused default name (Photo 3, Video 2, ...) and opens the dialog to confirm the names.
  function prepareUpload(e, kind) {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    try {
      checkMediaCapacity(place, files.length);
    } catch (e) {
      setError(e.message);
      return;
    }
    const existing = kind === 'photo' ? (boulder ? boulder.images : place.photos || []) : boulder.videos || [];
    const prefix = kind === 'photo' ? 'Photo' : 'Video';
    const used = new Set(existing.map(item => normalizeMediaName(item.name)));
    let number = existing.length + 1;
    const names = files.map(() => {
      while (used.has(normalizeMediaName(prefix + ' ' + number))) number++;
      const name = prefix + ' ' + number++;
      used.add(normalizeMediaName(name));
      return name;
    });
    setError('');
    setModal({ nameUploads: { files, names, kind } });
  }
  const upload = e => prepareUpload(e, 'photo');
  const uploadVideos = e => prepareUpload(e, 'video');
  // Files uploaded for a batch that then failed (a later file refused, or the guide save failed) would otherwise stay
  // stored but unused, counting towards the allowance. Best effort: the batch's own error is what the user sees.
  const discardUploads = items => {
    if (items.length)
      api('/api/uploads/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: items.map(item => item.url) }),
      }).catch(() => {});
  };
  async function uploadNamedPhotos(files, names, captions = []) {
    setBusy(true);
    setError('');
    const images = [];
    try {
      // Check every file before uploading any, so a bad file can't leave earlier ones stored but unused.
      for (const file of files) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
          throw new Error('Choose JPEG, PNG, or WebP images.');
        if (file.size > 8 * 1024 * 1024) throw new Error('Each image must be smaller than 8 MB.');
      }
      const latest = await api('/api/guide');
      const destination = latest.locations.find(item => item.id === place.id);
      if (!destination) throw new Error('This location no longer exists.');
      checkMediaCapacity(destination, files.length);
      for (const file of files) {
        const result = await api('/api/images', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
        images.push({
          id: uid(),
          name: names[images.length],
          caption: captions[images.length] || '',
          url: result.url,
          annotations: [],
          // Photos uploaded on a problem page are that problem's topos, so they stay off the boulder page.
          ...(boulder ? { onBoulderPage: !problem } : {}),
        });
      }
      const saved = !boulder
        ? await updatePlace({ photos: [...(place.photos || []), ...images] })
        : await updateBoulder({
            images: [...boulder.images, ...images],
            ...(problem
              ? {
                  problems: boulder.problems.map(p =>
                    p.id === problem.id ? { ...p, imageIds: [...p.imageIds, ...images.map(image => image.id)] } : p
                  ),
                }
              : {}),
          });
      if (saved) setModal(null);
      else discardUploads(images);
    } catch (e) {
      discardUploads(images);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadNamedVideos(files, names) {
    setBusy(true);
    setError('');
    const videos = [];
    try {
      for (const file of files) {
        if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type) && !/\.mov$/i.test(file.name))
          throw new Error('Choose MP4, WebM, or MOV videos.');
        if (file.size > videoMaxMB * 1024 * 1024) throw new Error(`Each video must be smaller than ${videoMaxMB} MB.`);
      }
      const latest = await api('/api/guide');
      const destination = latest.locations.find(item => item.id === place.id);
      if (!destination) throw new Error('This location no longer exists.');
      checkMediaCapacity(destination, files.length);
      for (const file of files) {
        const result = await api('/api/videos', {
          method: 'POST',
          headers: { 'Content-Type': /\.mov$/i.test(file.name) ? 'video/quicktime' : file.type },
          body: file,
        });
        videos.push({ id: uid(), name: names[videos.length], url: result.url });
      }
      const saved = await updateBoulder({
        videos: [...(boulder.videos || []), ...videos],
        ...(problem
          ? {
              problems: boulder.problems.map(p =>
                p.id === problem.id ? { ...p, videoIds: [...p.videoIds, ...videos.map(video => video.id)] } : p
              ),
            }
          : {}),
      });
      if (saved) setModal(null);
      else discardUploads(videos);
    } catch (e) {
      discardUploads(videos);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const home = !locationId;
  const goHome = () => {
    setLocationId(null);
    setBoulderId(null);
    setProblemId(null);
    location.hash = '#explore';
  };
  return (
    <div className="app">
      <div className="workspace">
        <header className="topbar">
          <a className="brand" href={user ? '#explore' : '#login'} aria-label="SideProj home">
            <span className="brand-mark" aria-hidden="true">
              △
            </span>{' '}
            Side<span className="brand-light">Proj</span>
          </a>
          <div className="header-actions">
            {user ? (
              <UserMenu user={user} logout={logout} />
            ) : (
              !loginPage && (
                <a className="secondary small" href="#login">
                  Log in
                </a>
              )
            )}
          </div>
        </header>
        {/* Which page to show. A signed-in user without a complete profile always gets the profile form first,
            and pages that need an account show the login page to guests. */}
        {user && (user.profileComplete === false || detailsPage) ? (
          <CompleteProfile
            key={user.id + (detailsPage ? '-details' : '-setup')}
            editing={user.profileComplete !== false}
            user={user}
            onComplete={async identity => {
              setUser(identity);
              try {
                setDb(await api('/api/guide'));
              } catch (e) {
                setError(e.message);
              }
              location.hash = '#explore';
            }}
          />
        ) : profileId ? (
          <PublicProfile key={profileId} id={profileId} user={user} onLogsChange={setLogs} />
        ) : user && friendsPage ? (
          <Friends key={user.id} />
        ) : user && logbookPage ? (
          <PublicProfile key={user.id} id={user.id} user={user} onLogsChange={setLogs} />
        ) : loginPage || detailsPage || logbookPage || friendsPage ? (
          <LoginPage
            onLogin={async identity => {
              setUser(identity);
              setDb(await api('/api/guide'));
              location.hash = '#explore';
            }}
          />
        ) : (
          <main className={home ? 'search-home' : 'location-page'}>
            {error && !modal?.nameUploads && (
              <div role="alert" className="error">
                {error}
                <button onClick={() => setError('')} aria-label="Dismiss error">
                  ×
                </button>
              </div>
            )}
            {/* Search and map when no location is chosen, otherwise the location, boulder or problem page. */}
            {home ? (
              <>
                <LocationSearch
                  locations={db.locations}
                  loaded={loaded}
                  canCreate={!!user}
                  busy={busy}
                  onCreate={() => {
                    setError('');
                    setModal('location');
                  }}
                />
                <LocationMap locations={db.locations} selectedId={null} onSelect={id => choose(id)} />
              </>
            ) : (
              <>
                <section id="location-details" className="detail-panel">
                  {!place ? (
                    <div className="welcome">
                      <PageNavigation place={place} boulder={boulder} problem={problem} problemId={problemId} />
                      <h2>{loaded ? 'Location not found' : 'Loading location...'}</h2>
                      {loaded && <p>This location may have been removed. Return to search to find another location.</p>}
                    </div>
                  ) : (
                    <>
                      {!boulder && (
                        <div className="detail-banner">
                          <PageNavigation place={place} boulder={boulder} problem={problem} problemId={problemId} />
                          <div className="eyebrow">
                            <Icon name="pin" /> CLIMBING LOCATION
                          </div>
                          <h2>{place.name}</h2>
                          <p className="created-by">
                            Created by <CreatorLink item={place} />
                          </p>
                          <div className="banner-bottom">
                            <span>
                              {countLabel(place.boulders.length, 'boulder')} ·{' '}
                              {countLabel(
                                place.boulders.reduce((s, b) => s + (b.problems || []).length, 0),
                                'problem'
                              )}{' '}
                              ·{' '}
                              {countLabel(
                                place.boulders.reduce((s, b) => s + b.images.length, 0),
                                'photo'
                              )}{' '}
                              ·{' '}
                              {countLabel(
                                place.boulders.reduce((s, b) => s + (b.videos || []).length, 0),
                                'video'
                              )}
                            </span>
                            <div className="location-actions">
                              {canEdit(place) && (
                                <button
                                  disabled={busy || !canEdit(place)}
                                  onClick={() => {
                                    setError('');
                                    setModal('editLocation');
                                  }}
                                >
                                  Edit location ↗
                                </button>
                              )}
                              {canEdit(place) && (
                                <button
                                  disabled={busy || !canEdit(place)}
                                  onClick={() => {
                                    setError('');
                                    setModal({ removeLocation: place });
                                  }}
                                >
                                  Remove location
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      {boulder && !problemId && (
                        <div className="detail-banner boulder-banner">
                          <PageNavigation place={place} boulder={boulder} problem={problem} problemId={problemId} />
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
                      )}
                      {problemId && boulder ? (
                        <ProblemPage
                          logged={logs.some(entry => entry.problem_id === problemId)}
                          logBusy={logBusy || logsLoading}
                          logError={logsError}
                          logProblem={() => logProblem(problemId, !logs.some(entry => entry.problem_id === problemId))}
                          guest={!user}
                          removePhoto={image => {
                            setError('');
                            setModal({ removeFromProblem: image, field: 'imageIds' });
                          }}
                          attach={kind => {
                            setError('');
                            setModal({ attachMedia: kind });
                          }}
                          removeVideo={video => {
                            setError('');
                            setModal({ removeFromProblem: video, field: 'videoIds' });
                          }}
                          upload={upload}
                          uploadVideos={uploadVideos}
                          canEdit={canEdit(problem)}
                          navigation={
                            <PageNavigation place={place} boulder={boulder} problem={problem} problemId={problemId} />
                          }
                          problem={problem}
                          boulder={boulder}
                          busy={busy}
                          remove={() => {
                            setError('');
                            setModal({ removeProblem: problem });
                          }}
                          edit={() => {
                            setError('');
                            setModal({ problemForm: true, problem });
                          }}
                          annotate={image => {
                            setError('');
                            setModal({
                              image: { ...image, annotations: problem.photoAnnotations?.[image.id] || [] },
                              problemId: problem.id,
                            });
                          }}
                          Shapes={Shapes}
                        />
                      ) : boulder ? (
                        <>
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
                                Show what {boulder.name} looks like so climbers can spot it. To mark a problem's holds
                                or line, open the problem and add a topo there.
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
                                A wide shot of the boulder or a photo of each face helps climbers recognise it. Photos
                                for a single problem belong on that problem's page.
                              </p>
                              <span>JPEG, PNG, WebP · up to 8 MB each</span>
                            </div>
                          ) : (
                            <div className="photo-grid">
                              {boulderPhotos.map(img => (
                                <div className="photo-item" key={img.id}>
                                  <div className="photo-card">
                                    <div className="photo-thumb">
                                      <img src={img.url} alt={img.name} />
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
                      ) : (
                        <>
                          <div className="location-info">
                            <div>
                              <h3>
                                <Icon name="pin" /> Coordinates
                              </h3>
                              {place.latitude && place.longitude ? (
                                <>
                                  <p className="coordinates">
                                    {Number(place.latitude).toFixed(5)}, {Number(place.longitude).toFixed(5)}
                                  </p>
                                  <a
                                    target="_blank"
                                    rel="noreferrer"
                                    href={
                                      'https://www.google.com/maps/search/?api=1&query=' +
                                      encodeURIComponent(`${place.latitude},${place.longitude}`)
                                    }
                                  >
                                    Open in maps ↗
                                  </a>
                                </>
                              ) : (
                                <button
                                  className="text-button"
                                  disabled={!canEdit(place)}
                                  onClick={() => setModal('editLocation')}
                                >
                                  + Add coordinates
                                </button>
                              )}
                            </div>
                            <div>
                              <h3>Approach notes</h3>
                              <p className="preserve">
                                {place.approach || 'Add parking details, the path to follow, and access information.'}
                              </p>
                            </div>
                          </div>
                          <section>
                            <div className="section-heading photos-heading">
                              <div>
                                <h3>Parking & Approach Photos</h3>
                                <p>Photos to help find the parking and approach.</p>
                              </div>
                              <label
                                title={!user ? 'Create an account to contribute' : undefined}
                                className={`secondary small upload ${busy || !user ? 'disabled' : ''}`}
                              >
                                + Upload photos
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  multiple
                                  disabled={busy || !user}
                                  onChange={upload}
                                />
                              </label>
                            </div>
                            {place.photos?.length ? (
                              <div className="photo-grid">
                                {place.photos.map(photo => (
                                  <figure className="problem-photo" key={photo.id}>
                                    <div className="photo-thumb">
                                      <img src={photo.url} alt={photo.caption || photo.name} />
                                    </div>
                                    <figcaption>
                                      <strong>{photo.name}</strong>
                                      <p className="preserve">{photo.caption}</p>
                                      {canEdit(photo) && (
                                        <div className="problem-media-actions">
                                          <button
                                            className="secondary small"
                                            disabled={busy}
                                            onClick={() => {
                                              setError('');
                                              setModal({ locationCaption: photo });
                                            }}
                                          >
                                            Edit caption
                                          </button>
                                          <button
                                            className="remove-media"
                                            disabled={busy}
                                            onClick={() => {
                                              setError('');
                                              setModal({ removeLocationPhoto: photo });
                                            }}
                                          >
                                            Remove photo
                                          </button>
                                        </div>
                                      )}
                                    </figcaption>
                                  </figure>
                                ))}
                              </div>
                            ) : (
                              <p className="problem-empty">No parking or approach photos yet.</p>
                            )}
                          </section>
                          <div className="section-heading boulders-heading">
                            <div>
                              <h3>
                                Boulders <span className="count">{place.boulders.length}</span>
                              </h3>
                              <p>The boulders at {place.name}.</p>
                            </div>
                            <button
                              title={!user ? 'Create an account to contribute' : undefined}
                              className="secondary small"
                              aria-disabled={busy || !user}
                              onClick={() => {
                                if (!busy && user) setModal('boulder');
                              }}
                            >
                              + Add boulder
                            </button>
                          </div>
                          {!place.boulders.length ? (
                            <div className="photo-empty">
                              <Icon name="mountain" />
                              <h3>A location full of possibilities.</h3>
                              <p>Add the first boulder to start adding problems, photos and videos.</p>
                            </div>
                          ) : (
                            <div className="boulder-list">
                              {place.boulders.map((b, i) => (
                                <button className="boulder-row" key={b.id} onClick={() => choose(place.id, b.id)}>
                                  <span className="boulder-avatar">
                                    {b.images[0] ? (
                                      <img
                                        src={(b.images.find(image => image.onBoulderPage !== false) || b.images[0]).url}
                                        alt=""
                                      />
                                    ) : (
                                      <Icon name="mountain" />
                                    )}
                                  </span>
                                  <div>
                                    <span className="eyebrow">BOULDER {String(i + 1).padStart(2, '0')}</span>
                                    <strong>{b.name}</strong>
                                    <p>{b.notes || 'Add directions to this boulder'}</p>
                                  </div>
                                  <span className="boulder-meta">
                                    {countLabel((b.problems || []).length, 'problem')} ·{' '}
                                    {countLabel(b.images.length, 'photo')} ·{' '}
                                    {countLabel((b.videos || []).length, 'video')}
                                  </span>
                                  <span>↗</span>
                                </button>
                              ))}
                            </div>
                          )}
                          <section className="location-links">
                            <div className="section-heading photos-heading">
                              <div>
                                <h3>Additional links</h3>
                                <p>UKC, tide charts, YouTube videos, relevant books and other useful resources.</p>
                              </div>
                              {canEdit(place) && (
                                <button
                                  className="secondary small"
                                  disabled={busy}
                                  onClick={() => {
                                    setError('');
                                    setModal({ locationLinks: true });
                                  }}
                                >
                                  Edit links
                                </button>
                              )}
                            </div>
                            {place.links?.length ? (
                              <ul>
                                {place.links
                                  .filter(link => validLocationLinks([link]))
                                  .map((link, index) => (
                                    <li key={index}>
                                      <a href={link.url} target="_blank" rel="noopener noreferrer">
                                        {link.label} ↗
                                      </a>
                                    </li>
                                  ))}
                              </ul>
                            ) : (
                              <p className="problem-empty">No additional links yet.</p>
                            )}
                          </section>
                        </>
                      )}
                    </>
                  )}
                </section>
              </>
            )}
            <footer>
              SideProj <span>Makes the planning easier, so you can climb harder.</span>
            </footer>
          </main>
        )}
      </div>
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
            {modal.nameUploads.files.map((file, index) => (
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
                if (await save({ ...db, locations: db.locations.filter(location => location.id !== id) })) {
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
      <div className="toast" role="status">
        {toast}
      </div>
    </div>
  );
}
function Shapes({ items, draft, onErase, ...props }) {
  function shape(s, i, hit = false) {
    const stroke = hit ? 'transparent' : s.color === 'green' ? '#35df79' : '#ff2929';
    const attrs = {
      stroke,
      ...(hit ? { strokeWidth: 18, pointerEvents: s.type === 'box' ? 'all' : 'stroke', fill: 'none' } : {}),
    };
    if (s.type === 'box')
      return (
        <rect
          {...attrs}
          x={Math.min(s.x, s.x2)}
          y={Math.min(s.y, s.y2)}
          width={Math.abs(s.x2 - s.x)}
          height={Math.abs(s.y2 - s.y)}
        />
      );
    if (s.type === 'arrow') {
      const angle = Math.atan2(s.y2 - s.y, s.x2 - s.x),
        size = Math.min(30, Math.hypot(s.x2 - s.x, s.y2 - s.y) / 2);
      return (
        <g {...attrs}>
          <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} />
          <polyline
            points={[
              [s.x2 - size * Math.cos(angle - 0.5), s.y2 - size * Math.sin(angle - 0.5)],
              [s.x2, s.y2],
              [s.x2 - size * Math.cos(angle + 0.5), s.y2 - size * Math.sin(angle + 0.5)],
            ]
              .map(p => p.join(','))
              .join(' ')}
          />
        </g>
      );
    }
    return s.type === 'line' ? (
      <line {...attrs} x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} />
    ) : (
      <polyline {...attrs} points={s.points.map(p => p.join(',')).join(' ')} />
    );
  }
  return (
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" {...props}>
      <g opacity="0.5" pointerEvents={onErase ? 'none' : undefined}>
        {[...items, ...(draft ? [draft] : [])].map((s, i) => (
          <g key={i}>{shape(s, i)}</g>
        ))}
      </g>
      {onErase &&
        items.map((s, i) => (
          <g
            className="annotation-erase-target"
            key={i}
            onPointerDown={e => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              onErase(i);
            }}
          >
            {shape(s, i, true)}
          </g>
        ))}
    </svg>
  );
}
function AnnotationEditor({ image, close, save, busy, error }) {
  const [items, setItems] = useState(image.annotations),
    [draft, setDraft] = useState(null),
    [tool, setTool] = useState('start');
  const drawing = useRef(null),
    history = useRef([]),
    stage = useRef(null),
    activePointer = useRef(null);
  // Closing (Cancel, ✕ or Escape) with unsaved changes asks first, so a stray Escape can't throw away a drawing.
  // Undoing back to the saved annotations counts as no change. Nothing closes while saving.
  const unsaved = JSON.stringify(items) !== JSON.stringify(image.annotations);
  const tryClose = () => {
    if (!busy && (!unsaved || window.confirm('Discard your unsaved annotations?'))) close();
  };
  useEffect(() => {
    const element = stage.current;
    // Native, non-passive handlers keep iOS Safari from treating a drawing as scrolling.
    const preventScroll = e => {
      if (e.cancelable) e.preventDefault();
    };
    element.addEventListener('touchstart', preventScroll, { passive: false });
    element.addEventListener('touchmove', preventScroll, { passive: false });
    return () => {
      element.removeEventListener('touchstart', preventScroll);
      element.removeEventListener('touchmove', preventScroll);
    };
  }, []);
  function cancelDrawing(e) {
    if (activePointer.current !== e.pointerId) return;
    drawing.current = null;
    activePointer.current = null;
    setDraft(null);
  }

  function changeItems(next) {
    history.current.push(items);
    setItems(next);
  }
  function undo() {
    if (history.current.length) setItems(history.current.pop());
  }

  const point = e => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1000, ((e.clientX - r.left) / r.width) * 1000)),
      Math.max(0, Math.min(1000, ((e.clientY - r.top) / r.height) * 1000)),
    ];
  };
  function start(e) {
    if (busy || tool === 'erase' || e.button !== 0 || activePointer.current !== null) return;
    e.preventDefault();
    activePointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = point(e);
    drawing.current = {
      type: tool === 'start' ? 'box' : tool,
      color: tool === 'start' ? 'green' : 'red',
      x,
      y,
      x2: x,
      y2: y,
      points: [[x, y]],
    };
    setDraft(drawing.current);
  }
  function move(e) {
    if (!drawing.current || activePointer.current !== e.pointerId) return;
    e.preventDefault();
    const [x2, y2] = point(e);
    drawing.current = { ...drawing.current, x2, y2, points: [...drawing.current.points, [x2, y2]] };
    setDraft(drawing.current);
  }
  function finish(e) {
    if (!drawing.current || activePointer.current !== e.pointerId) return;
    e.preventDefault();
    move(e);
    const s = drawing.current;
    if (Math.abs(s.x2 - s.x) + Math.abs(s.y2 - s.y) > 2 || s.points.length > 3) changeItems([...items, s]);
    drawing.current = null;
    activePointer.current = null;
    setDraft(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  return (
    <Modal title="Annotate photo" close={tryClose}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="annotation-toolbar" role="group" aria-label="Drawing tools">
        {[
          ['start', '□ Start holds · green'],
          ['box', '□ Other holds · red'],
          ['arrow', '↗ Arrow'],
          ['line', '╱ Line'],
          ['freehand', '〰 Freehand'],
          ['erase', 'Erase'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={'tool annotation-tool annotation-tool-' + key + (tool === key ? ' active' : '')}
            aria-pressed={tool === key}
            disabled={busy}
            onClick={() => setTool(key)}
          >
            {label}
          </button>
        ))}
        <button className="tool" disabled={busy || !history.current.length} onClick={undo}>
          ↶ Undo
        </button>
        <button className="tool" disabled={busy || !items.length} onClick={() => changeItems([])}>
          Clear
        </button>
      </div>
      <p className="annotation-help">Mark the holds or line for this problem</p>
      <div className="annotation-stage" ref={stage}>
        <img src={image.url} alt={image.name} draggable="false" />
        <Shapes
          items={items}
          draft={draft}
          className={tool === 'erase' ? 'annotation-erasing' : undefined}
          onErase={tool === 'erase' && !busy ? index => changeItems(items.filter((_, i) => i !== index)) : undefined}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={cancelDrawing}
          onLostPointerCapture={cancelDrawing}
          aria-label="Photo annotation canvas"
        />
      </div>
      <div className="form-actions">
        <button className="secondary" disabled={busy} onClick={tryClose}>
          Cancel
        </button>
        <button className="primary" disabled={busy} onClick={() => save(items)}>
          {busy ? 'Saving…' : 'Save annotations'}
        </button>
      </div>
    </Modal>
  );
}
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

function LocationLinksForm({ links, busy, error, cancel, save }) {
  const [items, setItems] = useState(links.map(link => ({ ...link, key: uid() })));
  const update = (key, field, value) =>
    setItems(old => old.map(item => (item.key === key ? { ...item, [field]: value } : item)));
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        save(items.map(({ label, url }) => ({ label: label.trim(), url: url.trim() })));
      }}
    >
      <p>Link to UKC, a local tide chart, YouTube beta, a relevant book or any other useful resources.</p>
      {items.map(item => (
        <fieldset className="media-picker" key={item.key} disabled={busy}>
          <label>
            Label
            <input
              required
              maxLength={120}
              value={item.label}
              onChange={e => update(item.key, 'label', e.target.value)}
              placeholder="e.g. Local tide times"
            />
          </label>
          <label>
            URL
            <input
              required
              type="url"
              maxLength={2048}
              value={item.url}
              onChange={e => update(item.key, 'url', e.target.value)}
              placeholder="https://..."
            />
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() => setItems(old => old.filter(link => link.key !== item.key))}
          >
            Remove link
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="secondary small"
        disabled={busy || items.length >= 50}
        onClick={() => setItems(old => [...old, { key: uid(), label: '', url: '' }])}
      >
        + Add link
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="secondary" disabled={busy} onClick={cancel}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          {busy ? 'Saving...' : 'Save links'}
        </button>
      </div>
    </form>
  );
}
