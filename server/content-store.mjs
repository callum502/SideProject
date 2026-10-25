import { enforceMediaLimits, MEDIA_LIMIT_MESSAGE, maxBytes, tooLargeMessage } from '../shared/media-limits.mjs';
import { enforcePostLimits, POST_LIMITS, limitMessage } from './post-limits.mjs';
import { mediaReference, mediaUrl } from './media-reference.mjs';
import { matchesType, SIGNATURE_BYTES } from '../shared/media-signatures.mjs';
import { loadEnv } from 'vite';
import { isDeepStrictEqual } from 'node:util';
import { authorizeChanges } from './ownership.mjs';
import { applyChanges, conflict } from '../shared/guide-changes.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const tables = ['locations', 'boulders', 'problems', 'media', 'problem_media'];
const mimeTypes = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};
// problem_media rows are links with no ID of their own, so they are keyed by the pair they join.
const rowKey = (table, row) => (table === 'problem_media' ? `${row.problem_id}/${row.media_id}` : row.id);

// Groups rows by `key`, keeping their order, so each parent finds its children without scanning every row.
const groupBy = (rows, key) => {
  const groups = new Map();
  for (const row of rows) {
    const id = row[key];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  return groups;
};

// Builds the nested guide the app uses (locations → boulders → problems, with their media and creators)
// from the table rows returned by read_content.
export function toGuide(snapshot) {
  const names = new Map(snapshot.profiles.map(p => [p.id, p.display_name]));
  const bouldersOf = groupBy(snapshot.boulders, 'location_id');
  const problemsOf = groupBy(snapshot.problems, 'boulder_id');
  const locationMedia = groupBy(snapshot.media, 'location_id');
  const boulderMedia = groupBy(snapshot.media, 'boulder_id');
  const linksOf = groupBy(snapshot.problem_media, 'problem_id');
  const owner = row => ({
    createdBy: row.created_by,
    createdByName: row.created_by ? names.get(row.created_by) || 'Climber' : 'Deleted User',
  });
  const media = row => {
    return {
      id: row.id,
      name: row.name,
      caption: row.caption || '',
      url: mediaUrl(row.storage_bucket, row.storage_path),
      ...owner(row),
      ...(row.kind === 'image' ? { annotations: row.annotations } : {}),
      ...(row.kind === 'image' && row.boulder_id ? { onBoulderPage: row.on_boulder_page !== false } : {}),
    };
  };
  return {
    locations: snapshot.locations.map(l => ({
      id: l.id,
      name: l.name,
      latitude: String(l.latitude),
      longitude: String(l.longitude),
      approach: l.approach_notes,
      links: l.additional_links || [],
      ...owner(l),
      photos: (locationMedia.get(l.id) || []).map(media),
      boulders: (bouldersOf.get(l.id) || []).map(b => {
        const images = (boulderMedia.get(b.id) || []).filter(m => m.kind === 'image');
        const videos = (boulderMedia.get(b.id) || []).filter(m => m.kind === 'video');
        return {
          id: b.id,
          name: b.name,
          notes: b.finding_notes,
          otherNotes: b.other_notes || '',
          ...owner(b),
          images: images.map(media),
          videos: videos.map(media),
          // A problem's attachments always belong to its own boulder (problem_media's foreign keys), so they are
          // listed in the boulder's media order.
          problems: (problemsOf.get(b.id) || []).map(p => {
            const attached = new Set((linksOf.get(p.id) || []).map(link => link.media_id));
            return {
              id: p.id,
              name: p.name,
              grade: p.grade,
              description: p.description,
              photoAnnotations: p.photo_annotations || {},
              ...owner(p),
              imageIds: images.filter(m => attached.has(m.id)).map(m => m.id),
              videoIds: videos.filter(m => attached.has(m.id)).map(m => m.id),
            };
          }),
        };
      }),
    })),
  };
}

// A new upload's size and type, read from Storage. Its type must match its extension and its contents, since the
// browser uploads files to Storage directly and this server never sees them otherwise.
async function uploadedFile(storage, path, mime, token) {
  if (!storage) throw fail('Enable Supabase Storage before saving uploads.', 503);
  const image = mime.startsWith('image/');
  const info = await storage.inspect(path, token, SIGNATURE_BYTES);
  if (info.mime !== mime || !matchesType(mime, info.bytes))
    throw fail(`The file is not a supported ${image ? 'image' : 'video'}.`);
  if (info.size > maxBytes(mime)) throw fail(tooLargeMessage(mime), 413);
  return info.size;
}

// The reverse of toGuide: flattens the guide into table rows. A media file's size comes from its previous row,
// or for a new upload from Storage (see uploadedFile).
export async function toRows(guide, previousMedia = [], storage = null, token) {
  const rows = Object.fromEntries(tables.map(table => [table, []]));
  const uploads = [];
  for (const l of guide.locations) {
    if (!l.latitude.trim() || !l.longitude.trim()) throw fail('Latitude and longitude are required.');
    rows.locations.push({
      id: l.id,
      name: l.name,
      latitude: +l.latitude,
      longitude: +l.longitude,
      approach_notes: l.approach,
      additional_links: l.links || [],
      created_by: l.createdBy,
    });
    // Location photos go through the same media code as a boulder's, saved with a location_id instead of a boulder_id.
    for (const b of [{ locationPhotos: true, images: l.photos || [], videos: [] }, ...l.boulders]) {
      if (!b.locationPhotos)
        rows.boulders.push({
          id: b.id,
          location_id: l.id,
          name: b.name,
          finding_notes: b.notes,
          other_notes: b.otherNotes || '',
          created_by: b.createdBy,
        });
      for (const [kind, items] of [
        ['image', b.images],
        ['video', b.videos || []],
      ])
        for (const m of items) {
          const ref = mediaReference(m.url);
          if (!ref) throw fail('Invalid uploaded file.');
          const storage_path = ref.path;
          const old = previousMedia.find(
            row => row.id === m.id && row.storage_bucket === ref.bucket && row.storage_path === storage_path
          );
          const mime = mimeTypes[storage_path.split('.').pop()];
          const row = {
            id: m.id,
            boulder_id: b.locationPhotos ? null : b.id,
            location_id: b.locationPhotos ? l.id : null,
            caption: m.caption || '',
            name: m.name,
            kind,
            storage_bucket: ref.bucket,
            storage_path,
            mime_type: mime,
            size_bytes: old?.size_bytes,
            annotations: kind === 'image' ? m.annotations : [],
            on_boulder_page: m.onBoulderPage !== false,
            created_by: m.createdBy,
          };
          rows.media.push(row);
          if (!row.size_bytes)
            uploads.push(uploadedFile(storage, storage_path, mime, token).then(size => (row.size_bytes = size)));
        }
      for (const p of b.problems || []) {
        rows.problems.push({
          id: p.id,
          boulder_id: b.id,
          name: p.name,
          grade: p.grade,
          description: p.description,
          photo_annotations: p.photoAnnotations || {},
          created_by: p.createdBy,
        });
        for (const id of [...p.imageIds, ...p.videoIds])
          rows.problem_media.push({ problem_id: p.id, media_id: id, boulder_id: b.id });
      }
    }
  }
  await Promise.all(uploads);
  return rows;
}

// The deletes, inserts and updates that turn the `before` rows into `after`. Deletes are listed children first
// and inserts parents first, so foreign keys hold at every step.
export function contentOperations(before, after) {
  const operations = [];
  const maps = rows => Object.fromEntries(tables.map(t => [t, new Map(rows[t].map(row => [rowKey(t, row), row]))]));
  const old = maps(before),
    next = maps(after);
  // Explicit link deletions only for surviving records; FK cascades handle removed media/problems.
  for (const t of [...tables].reverse())
    for (const [key, row] of old[t])
      if (!next[t].has(key)) {
        if (t === 'problem_media' && (!next.problems.has(row.problem_id) || !next.media.has(row.media_id))) continue;
        operations.push({ table: t, action: 'delete', row });
      }
  for (const t of tables)
    for (const [key, row] of next[t]) {
      const previous = old[t].get(key);
      if (!previous) operations.push({ table: t, action: 'insert', row });
      // The version read here lets save_content reject the update if the row changed since.
      else if (!isDeepStrictEqual(row, Object.fromEntries(Object.keys(row).map(k => [k, previous[k]]))))
        operations.push({ table: t, action: 'update', row: { ...row, version: previous.version } });
    }
  return operations;
}

// Reads and saves the guide through the read_content and save_content database functions.
export function createContentStore({
  env = { ...loadEnv('development', process.cwd(), ''), ...process.env },
  fetchImpl = fetch,
  storage = null,
} = {}) {
  // Calls a database function, turning its error codes into user-facing messages.
  async function rpc(name, values = {}, token) {
    if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
      throw fail('Configure Supabase before loading content.', 503);
    let response;
    try {
      response = await fetchImpl(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(values),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw fail('Database is unavailable. Your changes were not confirmed; reload before retrying.', 503);
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (result?.code === 'PZ002') throw fail(MEDIA_LIMIT_MESSAGE, 400);
      if (result?.code === 'PZ001' && Object.hasOwn(POST_LIMITS, result?.details || ''))
        throw fail(limitMessage(result.details), 400);
      // Row changed or removed, duplicate insert, parent removed/child added concurrently,
      // or concurrent saves deadlocked.
      if (['40001', '23505', '23503', '40P01'].includes(result?.code)) throw conflict();
      if (response.status === 401) throw fail('Your session expired. Log in again.', 401);
      if (result?.code === '42501') throw fail('You do not have permission to change one of these records.', 403);
      if (result?.code === 'PGRST202')
        throw fail('Apply the content API SQL migration before switching to Supabase content.', 503);
      if (result?.code?.startsWith('22') || result?.code?.startsWith('23'))
        throw fail('Invalid content or relationships. Check required fields and attachments.', 400);
      throw fail('Could not load or save database content. Check the Supabase migration and service status.', 503);
    }
    return result;
  }
  return {
    // The whole guide. The app loads one location at a time instead (summaries and readLocation).
    async read(token) {
      return toGuide(await rpc('read_content', {}, token));
    },
    // Every location's ID, name and coordinates, for search and the map.
    async summaries(token) {
      const locations = await rpc('read_location_summaries', {}, token);
      return {
        locations: locations.map(l => ({ ...l, latitude: String(l.latitude), longitude: String(l.longitude) })),
      };
    },
    // A guide holding just this location, or no locations if it doesn't exist.
    async readLocation(id, token) {
      return toGuide(await rpc('read_location', { target: id }, token));
    },
    // `check` validates the merged guide before any permission checks or writes. With `locationId`, the changes must
    // all be within that location (or create or remove it); only it is read and returned.
    async save(changes, user, token, check = () => {}, locationId = null) {
      const snapshot = locationId
        ? await rpc('read_location', { target: locationId }, token)
        : await rpc('read_content', {}, token);
      const previous = toGuide(snapshot);
      // A change under a location outside the snapshot has no parent here, so applyChanges reports a conflict.
      const incoming = applyChanges(previous, changes);
      if (locationId && incoming.locations.some(l => l.id !== locationId))
        throw fail('Save changes to one location at a time.');
      check(incoming, previous);
      authorizeChanges(previous, incoming, user);
      enforcePostLimits(previous, incoming, user.id);
      enforceMediaLimits(previous, incoming);
      const rows = await toRows(incoming, snapshot.media, storage, token);
      const operations = contentOperations(snapshot, rows);
      const saved = toGuide(
        await rpc('save_content', locationId ? { operations, target_location: locationId } : { operations }, token)
      );
      // Delete the files of removed photos and videos, so they stop using storage and their links stop working.
      // The save has already succeeded, so a failure here only leaves the file behind (logged, not shown).
      const removed = operations
        .filter(op => op.table === 'media' && op.action === 'delete')
        .map(op => op.row.storage_path);
      if (removed.length && storage?.remove)
        await storage
          .remove(removed, token)
          .catch(error => console.error('Could not delete removed media files:', error.message));
      return saved;
    },
  };
}
