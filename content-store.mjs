import { enforceMediaLimits, MEDIA_LIMIT_MESSAGE } from './media-limits.mjs';
import { enforcePostLimits, POST_LIMITS, limitMessage } from './post-limits.mjs';
import { mediaReference, mediaUrl } from './media-reference.mjs';
import { loadEnv } from 'vite';
import { isDeepStrictEqual } from 'node:util';
import { authorizeChanges } from './ownership.mjs';
import { applyChanges, conflict } from './guide-changes.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const tables = ['locations', 'boulders', 'problems', 'media', 'problem_media'];
const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
const rowKey = (table, row) => table === 'problem_media' ? `${row.problem_id}/${row.media_id}` : row.id;

export function toGuide(snapshot) {
  const names = new Map(snapshot.profiles.map(p => [p.id, p.display_name]));
  const owner = row => ({ createdBy: row.created_by, createdByName: row.created_by ? names.get(row.created_by) || 'Climber' : 'Deleted User' });
  const media = row => {
    return { id: row.id, name: row.name, caption: row.caption || '', url: mediaUrl(row.storage_bucket, row.storage_path), ...owner(row), ...(row.kind === 'image' ? { annotations: row.annotations } : {}) };
  };
  return { locations: snapshot.locations.map(l => ({
    id: l.id, name: l.name, latitude: String(l.latitude), longitude: String(l.longitude), approach: l.approach_notes, links: l.additional_links || [], ...owner(l),
    photos: snapshot.media.filter(m => m.location_id === l.id).map(media),
    boulders: snapshot.boulders.filter(b => b.location_id === l.id).map(b => ({
      id: b.id, name: b.name, notes: b.finding_notes, otherNotes: b.other_notes || '', ...owner(b),
      images: snapshot.media.filter(m => m.boulder_id === b.id && m.kind === 'image').map(media),
      videos: snapshot.media.filter(m => m.boulder_id === b.id && m.kind === 'video').map(media),
      problems: snapshot.problems.filter(p => p.boulder_id === b.id).map(p => {
        const attached = new Set(snapshot.problem_media.filter(link => link.problem_id === p.id).map(link => link.media_id));
        return { id: p.id, name: p.name, grade: p.grade, description: p.description, photoAnnotations: p.photo_annotations || {}, ...owner(p),
          imageIds: snapshot.media.filter(m => attached.has(m.id) && m.kind === 'image').map(m => m.id),
          videoIds: snapshot.media.filter(m => attached.has(m.id) && m.kind === 'video').map(m => m.id) };
      }),
    })),
  })) };
}

export async function toRows(guide, previousMedia = [], storage = null, token) {
  const rows = Object.fromEntries(tables.map(table => [table, []]));
  for (const l of guide.locations) {
    if (!l.latitude.trim() || !l.longitude.trim()) throw fail('Latitude and longitude are required.');
    rows.locations.push({ id: l.id, name: l.name, latitude: +l.latitude, longitude: +l.longitude, approach_notes: l.approach, additional_links: l.links || [], created_by: l.createdBy });
    for (const b of [{ locationPhotos: true, images: l.photos || [], videos: [] }, ...l.boulders]) {
      if (!b.locationPhotos) rows.boulders.push({ id: b.id, location_id: l.id, name: b.name, finding_notes: b.notes, other_notes: b.otherNotes || '', created_by: b.createdBy });
      for (const [kind, items] of [['image', b.images], ['video', b.videos || []]]) for (const m of items) {
        const ref = mediaReference(m.url);
        if (!ref) throw fail('Invalid uploaded file.');
        const storage_path = ref.path;
        const old = previousMedia.find(row => row.id === m.id && row.storage_bucket === ref.bucket && row.storage_path === storage_path);
        let size = old?.size_bytes;
        const mime = mimeTypes[storage_path.split('.').pop()];
        if (!size) {
          if (!storage) throw fail('Enable Supabase Storage before saving uploads.',503);
          const info = await storage.stat(storage_path, token);
          if (info.mime !== mime) throw fail('Uploaded file type does not match.');
          size = info.size;
        }
        rows.media.push({ id: m.id, boulder_id: b.locationPhotos ? null : b.id, location_id: b.locationPhotos ? l.id : null, caption: m.caption || '', name: m.name, kind, storage_bucket: ref.bucket, storage_path, mime_type: mime, size_bytes: size, annotations: kind === 'image' ? m.annotations : [], created_by: m.createdBy });
      }
      for (const p of b.problems || []) {
        rows.problems.push({ id: p.id, boulder_id: b.id, name: p.name, grade: p.grade, description: p.description, photo_annotations: p.photoAnnotations || {}, created_by: p.createdBy });
        for (const id of [...p.imageIds, ...p.videoIds]) rows.problem_media.push({ problem_id: p.id, media_id: id, boulder_id: b.id });
      }
    }
  }
  return rows;
}

export function contentOperations(before, after) {
  const operations = [];
  const maps = rows => Object.fromEntries(tables.map(t => [t, new Map(rows[t].map(row => [rowKey(t, row), row]))]));
  const old = maps(before), next = maps(after);
  // Explicit link deletions only for surviving records; FK cascades handle removed media/problems.
  for (const t of [...tables].reverse()) for (const [key, row] of old[t]) if (!next[t].has(key)) {
    if (t === 'problem_media' && (!next.problems.has(row.problem_id) || !next.media.has(row.media_id))) continue;
    operations.push({ table: t, action: 'delete', row });
  }
  for (const t of tables) for (const [key, row] of next[t]) {
    const previous = old[t].get(key);
    if (!previous) operations.push({ table: t, action: 'insert', row });
    // The version read here lets save_content reject the update if the row changed since.
    else if (!isDeepStrictEqual(row, Object.fromEntries(Object.keys(row).map(k => [k, previous[k]])))) operations.push({ table: t, action: 'update', row: { ...row, version: previous.version } });
  }
  return operations;
}

export function createContentStore({ env = { ...loadEnv('development', process.cwd(), ''), ...process.env }, fetchImpl = fetch, storage = null } = {}) {
  async function rpc(name, values = {}, token) {
    if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw fail('Configure Supabase before loading content.', 503);
    let response;
    try { response = await fetchImpl(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(values), signal: AbortSignal.timeout(20000) }); }
    catch { throw fail('Database is unavailable. Your changes were not confirmed; reload before retrying.', 503); }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (result?.code === 'PZ002') throw fail(MEDIA_LIMIT_MESSAGE,400);
      if (result?.code === 'PZ001' && Object.hasOwn(POST_LIMITS,result?.details || '')) throw fail(limitMessage(result.details),400);
      // Row changed or removed, duplicate insert, parent removed/child added concurrently, or concurrent saves deadlocked.
      if (['40001', '23505', '23503', '40P01'].includes(result?.code)) throw conflict();
      if (response.status === 401) throw fail('Your session expired. Log in again.', 401);
      if (result?.code === '42501') throw fail('You do not have permission to change one of these records.', 403);
      if (result?.code === 'PGRST202') throw fail('Apply the content API SQL migration before switching to Supabase content.', 503);
      if (result?.code?.startsWith('22') || result?.code?.startsWith('23')) throw fail('Invalid content or relationships. Check required fields and attachments.', 400);
      throw fail('Could not load or save database content. Check the Supabase migration and service status.', 503);
    }
    return result;
  }
  return {
    async read(token) { return toGuide(await rpc('read_content', {}, token)); },
    // `check` validates the merged guide before any permission checks or writes.
    async save(changes, user, token, check = () => {}) {
      const snapshot = await rpc('read_content', {}, token);
      const previous = toGuide(snapshot);
      const incoming = applyChanges(previous, changes);
      check(incoming, previous);
      authorizeChanges(previous, incoming, user);
      enforcePostLimits(previous, incoming, user.id);
      enforceMediaLimits(previous, incoming);
      const rows = await toRows(incoming, snapshot.media, storage, token);
      const operations = contentOperations(snapshot, rows);
      const saved = toGuide(await rpc('save_content', { operations }, token));
      // Delete the files of removed photos and videos, so they stop using storage and their links stop working.
      // The save has already succeeded, so a failure here only leaves the file behind (logged, not shown).
      const removed = operations.filter(op => op.table === 'media' && op.action === 'delete').map(op => op.row.storage_path);
      if (removed.length && storage?.remove) await storage.remove(removed, token).catch(error => console.error('Could not delete removed media files:', error.message));
      return saved;
    },
  };
}
