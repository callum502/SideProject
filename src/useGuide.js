import { useEffect, useState } from 'react';
import { guideChanges } from '../shared/guide-changes.mjs';
import { api } from './api';

// The guide as far as it is loaded: every location's name and coordinates (for search and the map), and in full
// (with `boulders`) each location that has been opened, which is loaded whenever `locationId` changes. `loaded` is
// whether the list of locations has arrived, and `missingId` the opened location the server reported as not found.
// Saving reports through `setBusy`, `setError` and `setToast`.
export function useGuide({ locationId, setBusy, setError, setToast }) {
  const [db, setDb] = useState({ locations: [] }),
    [loaded, setLoaded] = useState(false);
  const [missingId, setMissingId] = useState(null);
  // Replaces one location with its copy from a guide the server sent, or removes it if the guide doesn't have it.
  const putLocation = (id, guide) =>
    setDb(current => {
      const latest = guide.locations.find(l => l.id === id);
      const index = current.locations.findIndex(l => l.id === id);
      if (!latest) return { ...current, locations: current.locations.filter(l => l.id !== id) };
      const locations = [...current.locations];
      if (index < 0) locations.push(latest);
      else locations[index] = latest;
      return { ...current, locations };
    });
  // Loads the list of locations, keeping any already loaded in full.
  const loadLocations = async () => {
    const data = await api('/api/locations');
    setDb(current => ({
      ...current,
      locations: data.locations.map(
        summary => current.locations.find(l => l.id === summary.id && l.boulders) || summary
      ),
    }));
    setLoaded(true);
  };
  useEffect(() => {
    loadLocations().catch(e => setError(e.message));
  }, []);
  // A location is loaded in full whenever it is opened, so it shows the latest changes.
  useEffect(() => {
    if (!locationId) return;
    let current = true;
    api('/api/locations/' + encodeURIComponent(locationId))
      .then(guide => current && putLocation(locationId, guide))
      .catch(e => {
        if (!current) return;
        if (e.status !== 404) return setError(e.message);
        setMissingId(locationId);
        putLocation(locationId, { locations: [] });
      });
    return () => {
      current = false;
    };
  }, [locationId]);
  // The latest copy of a location, read just before adding photos or videos to check its media limit.
  const latestLocation = id =>
    api('/api/locations/' + encodeURIComponent(id)).then(
      guide => guide.locations[0],
      e => {
        throw e.status === 404 ? new Error('This location no longer exists.') : e;
      }
    );
  // Sends only the records that differ from the loaded guide, all within the location `scope`; the server replies
  // with that location's latest copy (none once it is removed).
  async function save(next, scope) {
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/guide', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: guideChanges(db, next), location: scope }),
      });
      putLocation(scope, result);
      setToast('Changes saved');
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { db, loaded, missingId, loadLocations, latestLocation, save };
}
