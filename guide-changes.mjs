// Saves send only the records a user changed, each with the copy they started from (`base`).
// The server applies them to the latest guide, so concurrent edits to different records both succeed.
const FIELDS = {
  location: ['name', 'latitude', 'longitude', 'approach', 'links', 'createdBy'],
  photo: ['name', 'caption', 'url', 'annotations', 'createdBy'],
  boulder: ['name', 'notes', 'otherNotes', 'createdBy'],
  image: ['name', 'caption', 'url', 'annotations', 'onBoulderPage', 'createdBy'],
  video: ['name', 'caption', 'url', 'createdBy'],
  problem: ['name', 'grade', 'description', 'photoAnnotations', 'imageIds', 'videoIds', 'createdBy'],
};
const CHILDREN = {
  location: { photos: 'photo', boulders: 'boulder' },
  boulder: { images: 'image', videos: 'video', problems: 'problem' },
};
const PLACE = Object.fromEntries(
  Object.entries(CHILDREN).flatMap(([parent, lists]) =>
    Object.entries(lists).map(([key, type]) => [type, { parent, key }])
  )
);
export const MAX_CHANGES = 10000;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const conflict = () =>
  fail('Someone else changed this while you were editing. Reload before saving again.', 409);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (type, record) =>
  Object.fromEntries(FIELDS[type].filter(field => record[field] !== undefined).map(field => [field, record[field]]));

// Key order differs between client-built objects and PostgreSQL jsonb, so compare structurally.
export function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a).filter(key => a[key] !== undefined);
  return (
    keys.length === Object.keys(b).filter(key => b[key] !== undefined).length &&
    keys.every(key => equal(a[key], b[key]))
  );
}

function flatten(guide) {
  const records = new Map();
  const visit = (items, type, parentId) => {
    for (const item of items || []) {
      records.set(item.id, { type, parentId, record: item });
      for (const [key, child] of Object.entries(CHILDREN[type] || {})) visit(item[key], child, item.id);
    }
  };
  visit(guide.locations, 'location', null);
  return records;
}

export function guideChanges(before, after) {
  const old = flatten(before),
    next = flatten(after),
    changes = [];
  for (const [id, { type, parentId, record }] of next) {
    const previous = old.get(id),
      base = previous ? own(previous.type, previous.record) : null,
      value = own(type, record);
    if (!previous || previous.type !== type || previous.parentId !== parentId || !equal(base, value))
      changes.push({ action: 'put', type, id, parentId, base, value });
  }
  for (const [id, { type, parentId, record }] of old)
    if (!next.has(id)) changes.push({ action: 'delete', type, id, parentId, base: own(type, record) });
  return changes;
}

export function applyChanges(current, changes) {
  if (!Array.isArray(changes) || changes.length > MAX_CHANGES) throw fail('Invalid changes.');
  const records = flatten(current),
    seen = new Set();
  for (const change of changes) {
    const { action, type, id, parentId, base, value } = plain(change) ? change : {};
    if (
      !['put', 'delete'].includes(action) ||
      !Object.hasOwn(FIELDS, type) ||
      typeof id !== 'string' ||
      !id ||
      id.length > 100 ||
      seen.has(id) ||
      (type === 'location' ? parentId !== null : !(typeof parentId === 'string' && parentId)) ||
      (base !== null && !plain(base)) ||
      (action === 'put' ? !plain(value) : base === null)
    )
      throw fail('Invalid changes.');
    seen.add(id);
    // The record must still match what the user started from; new records must not exist yet.
    const now = records.get(id);
    if (
      base === null
        ? now
        : !now || now.type !== type || now.parentId !== parentId || !equal(own(type, now.record), own(type, base))
    )
      throw conflict();
    if (action === 'delete') records.delete(id);
    else records.set(id, { type, parentId, record: { ...(now ? now.record : { id }), ...own(type, value) } });
  }
  const nodes = new Map(
    [...records].map(([id, entry]) => [
      id,
      {
        ...entry,
        record: {
          ...entry.record,
          ...Object.fromEntries(Object.keys(CHILDREN[entry.type] || {}).map(key => [key, []])),
        },
      },
    ])
  );
  const locations = [];
  for (const { type, parentId, record } of nodes.values()) {
    if (type === 'location') {
      locations.push(record);
      continue;
    }
    // A missing parent means it was removed (by someone else, or by this save without the children it now has).
    const parent = nodes.get(parentId);
    if (parent?.type !== PLACE[type].parent) throw conflict();
    parent.record[PLACE[type].key].push(record);
  }
  return { locations };
}
