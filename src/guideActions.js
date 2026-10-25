import { checkMediaCapacity, IMAGE_MAX_MB, VIDEO_MAX_MB } from '../shared/media-limits.mjs';
import { normalizeMediaName } from '../shared/media-names.mjs';
import { api, uploadFile, contentsMatch } from './api';
import { uid } from './ui';

// The edits the guide pages and dialogs make to the open location, boulder and problem, including uploads. Each
// saves through `save` (from useGuide) and reports through `setBusy`, `setError` and `setModal`.
export function guideActions({
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
}) {
  const updatePlace = async patch =>
    save({ ...db, locations: db.locations.map(l => (l.id === place.id ? { ...l, ...patch } : l)) }, place.id);
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
        modal === 'location'
          ? await save({ ...db, locations: [...db.locations, item] }, item.id)
          : await updatePlace(form);
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
        if (file.size > IMAGE_MAX_MB * 1024 * 1024)
          throw new Error(`Each image must be smaller than ${IMAGE_MAX_MB} MB.`);
        if (!(await contentsMatch(file, file.type))) throw new Error('The file is not a supported image.');
      }
      checkMediaCapacity(await latestLocation(place.id), files.length);
      for (const file of files) {
        const result = await uploadFile(file, file.type);
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
  // Browsers may not give MOV files a type, so the extension decides.
  const videoType = file => (/\.mov$/i.test(file.name) ? 'video/quicktime' : file.type);
  async function uploadNamedVideos(files, names) {
    setBusy(true);
    setError('');
    const videos = [];
    try {
      for (const file of files) {
        if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type) && !/\.mov$/i.test(file.name))
          throw new Error('Choose MP4, WebM, or MOV videos.');
        if (file.size > VIDEO_MAX_MB * 1024 * 1024)
          throw new Error(`Each video must be smaller than ${VIDEO_MAX_MB} MB.`);
        if (!(await contentsMatch(file, videoType(file)))) throw new Error('The file is not a supported video.');
      }
      checkMediaCapacity(await latestLocation(place.id), files.length);
      for (const file of files) {
        const result = await uploadFile(file, videoType(file));
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
  return {
    updatePlace,
    updateBoulder,
    updateProblems,
    deletesWithProblem,
    submit,
    upload,
    uploadVideos,
    uploadNamedPhotos,
    uploadNamedVideos,
  };
}
