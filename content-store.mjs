import { loadEnv } from 'vite';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { authorizeChanges } from './ownership.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const tables = ['locations', 'boulders', 'problems', 'media', 'problem_media'];
const mimeTypes = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
const rowKey = (table, row) => table === 'problem_media' ? `${row.problem_id}/${row.media_id}` : row.id;

export function toGuide(snapshot) {
  const names = new Map(snapshot.profiles.map(p => [p.id, p.display_name]));
  const owner = row => ({ createdBy: row.created_by, createdByName: names.get(row.created_by) || 'Climber' });
  const media = row => {
    if (row.storage_bucket !== 'local' || !/^[a-f0-9-]+\.(png|jpg|webp|mp4|webm|mov)$/.test(row.storage_path)) throw fail('This media needs the Storage integration before it can be displayed.', 503);
    return { id: row.id, name: row.name, url: `/uploads/${row.storage_path}`, ...owner(row), ...(row.kind === 'image' ? { annotations: row.annotations } : {}) };
  };
  return { revision: snapshot.revision, locations: snapshot.locations.map(l => ({
    id: l.id, name: l.name, region: l.region, latitude: String(l.latitude), longitude: String(l.longitude), approach: l.approach_notes, ...owner(l),
    boulders: snapshot.boulders.filter(b => b.location_id === l.id).map(b => ({
      id: b.id, name: b.name, notes: b.finding_notes, ...owner(b),
      images: snapshot.media.filter(m => m.boulder_id === b.id && m.kind === 'image').map(media),
      videos: snapshot.media.filter(m => m.boulder_id === b.id && m.kind === 'video').map(media),
      problems: snapshot.problems.filter(p => p.boulder_id === b.id).map(p => {
        const attached = new Set(snapshot.problem_media.filter(link => link.problem_id === p.id).map(link => link.media_id));
        return { id: p.id, name: p.name, grade: p.grade, description: p.description, ...owner(p),
          imageIds: snapshot.media.filter(m => attached.has(m.id) && m.kind === 'image').map(m => m.id),
          videoIds: snapshot.media.filter(m => attached.has(m.id) && m.kind === 'video').map(m => m.id) };
      }),
    })),
  })) };
}

export async function toRows(guide, dataDir, previousMedia = []) {
  const rows = Object.fromEntries(tables.map(table => [table, []]));
  for (const l of guide.locations) {
    if (!l.latitude.trim() || !l.longitude.trim()) throw fail('Latitude and longitude are required.');
    rows.locations.push({ id: l.id, name: l.name, region: l.region, latitude: +l.latitude, longitude: +l.longitude, approach_notes: l.approach, created_by: l.createdBy });
    for (const b of l.boulders) {
      rows.boulders.push({ id: b.id, location_id: l.id, name: b.name, finding_notes: b.notes, created_by: b.createdBy });
      for (const [kind, items] of [['image', b.images], ['video', b.videos || []]]) for (const m of items) {
        if (!/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp|mp4|webm|mov)$/.test(m.url)) throw fail('Invalid uploaded file.');
        const storage_path = m.url.slice('/uploads/'.length);
        const old = previousMedia.find(row => row.id === m.id && row.storage_bucket === 'local' && row.storage_path === storage_path);
        let size = old?.size_bytes;
        if (!size) {
          try { const info = await stat(path.join(dataDir, 'uploads', storage_path)); if (!info.isFile()) throw new Error(); size = info.size; }
          catch { throw fail('An uploaded file is missing. Please upload it again.'); }
        }
        rows.media.push({ id: m.id, boulder_id: b.id, name: m.name, kind, storage_bucket: 'local', storage_path, mime_type: mimeTypes[storage_path.split('.').pop()], size_bytes: size, annotations: kind === 'image' ? m.annotations : [], created_by: m.createdBy });
      }
      for (const p of b.problems || []) {
        rows.problems.push({ id: p.id, boulder_id: b.id, name: p.name, grade: p.grade, description: p.description, created_by: p.createdBy });
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
    else if (!isDeepStrictEqual(row, Object.fromEntries(Object.keys(row).map(k => [k, previous[k]])))) operations.push({ table: t, action: 'update', row });
  }
  return operations;
}

export function createContentStore({ env = { ...loadEnv('development', process.cwd(), ''), ...process.env }, fetchImpl = fetch } = {}) {
  if (env.CONTENT_STORE === 'json') return null;
  if (env.CONTENT_STORE && env.CONTENT_STORE !== 'supabase') throw new Error('CONTENT_STORE must be json or supabase.');
  async function rpc(name, values = {}, token) {
    if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) throw fail('Configure Supabase before loading content.', 503);
    let response;
    try { response = await fetchImpl(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(values), signal: AbortSignal.timeout(20000) }); }
    catch { throw fail('Database is unavailable. Your changes were not confirmed; reload before retrying.', 503); }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (result?.code === '40001' || result?.code === '23505') throw fail('This guide changed. Reload before saving again.', 409);
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
    async save(incoming, user, token, dataDir) {
      const snapshot = await rpc('read_content', {}, token);
      if (incoming.revision !== snapshot.revision) throw fail('This guide changed. Reload before saving again.', 409);
      authorizeChanges(toGuide(snapshot), incoming, user);
      const rows = await toRows(incoming, dataDir, snapshot.media);
      const operations = contentOperations(snapshot, rows);
      return toGuide(await rpc('save_content', { expected_revision: incoming.revision, operations }, token));
    },
  };
}
