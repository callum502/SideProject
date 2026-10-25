import React, { useEffect, useState } from 'react';
import PublicProfile from './PublicProfile';
import Friends from './Friends';
import UserMenu from './UserMenu';
import CompleteProfile from './CompleteProfile';
import LocationMap from './LocationMap';
import LoginPage from './LoginPage';
import LocationSearch from './LocationSearch';
import PageNavigation from './PageNavigation';
import { ProblemPage } from './Problems';
import LocationPage from './LocationPage';
import BoulderPage from './BoulderPage';
import GuideModals from './GuideModals';
import Shapes from './Shapes';
import { api } from './api';
import { useGuide } from './useGuide';
import { useLogbook } from './useLogbook';
import { guideActions } from './guideActions';

// The whole app. The page comes from the URL hash: #login, #friends, #logbook, #details, user=<id> for a public
// profile, and location=<id>&boulder=<id>&problem=<id> for the guide (search and map when none is set).
export default function App() {
  const [profileId, setProfileId] = useState(new URLSearchParams(location.hash.slice(1)).get('user'));
  const [friendsPage, setFriendsPage] = useState(location.hash === '#friends');
  const [logbookPage, setLogbookPage] = useState(location.hash === '#logbook');
  const [detailsPage, setDetailsPage] = useState(location.hash === '#details');
  const [user, setUser] = useState(null),
    [loginPage, setLoginPage] = useState(!location.hash || location.hash === '#' || location.hash === '#login');
  const { logs, setLogs, logsLoading, logsError, logBusy, logProblem } = useLogbook(user, logbookPage);
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
  const [locationId, setLocationId] = useState(null),
    [boulderId, setBoulderId] = useState(null);
  const [problemId, setProblemId] = useState(null);
  const [modal, setModal] = useState(null),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [toast, setToast] = useState('');
  const { db, loaded, missingId, loadLocations, latestLocation, save } = useGuide({
    locationId,
    setBusy,
    setError,
    setToast,
  });
  useEffect(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    setLocationId(params.get('location'));
    setBoulderId(params.get('boulder'));
    setProblemId(params.get('problem'));
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
  const place = db.locations.find(l => l.id === locationId && l.boulders);
  const boulder = place?.boulders.find(b => b.id === boulderId);
  const problem = boulder?.problems?.find(p => p.id === problemId);
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
  const actions = guideActions({
    db,
    save,
    latestLocation,
    place,
    boulder,
    problem,
    modal,
    setModal,
    setError,
    setBusy,
    canEdit,
    choose,
  });
  const { upload, uploadVideos } = actions;
  const home = !locationId;
  const goHome = () => {
    setLocationId(null);
    setBoulderId(null);
    setProblemId(null);
    location.hash = '#explore';
  };
  const navigation = <PageNavigation place={place} boulder={boulder} problem={problem} problemId={problemId} />;
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
                await loadLocations();
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
              await loadLocations();
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
                      {navigation}
                      <h2>{missingId === locationId ? 'Location not found' : 'Loading location...'}</h2>
                      {missingId === locationId && (
                        <p>This location may have been removed. Return to search to find another location.</p>
                      )}
                    </div>
                  ) : problemId && boulder ? (
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
                      navigation={navigation}
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
                    <BoulderPage
                      place={place}
                      boulder={boulder}
                      user={user}
                      busy={busy}
                      canEdit={canEdit}
                      upload={upload}
                      logs={logs}
                      setModal={setModal}
                      setError={setError}
                      navigation={navigation}
                    />
                  ) : (
                    <LocationPage
                      place={place}
                      user={user}
                      busy={busy}
                      canEdit={canEdit}
                      upload={upload}
                      choose={choose}
                      setModal={setModal}
                      setError={setError}
                      navigation={navigation}
                    />
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
      <GuideModals
        modal={modal}
        setModal={setModal}
        busy={busy}
        error={error}
        setError={setError}
        setToast={setToast}
        db={db}
        save={save}
        place={place}
        boulder={boulder}
        problem={problem}
        user={user}
        canEdit={canEdit}
        choose={choose}
        goHome={goHome}
        actions={actions}
      />
      <div className="toast" role="status">
        {toast}
      </div>
    </div>
  );
}
