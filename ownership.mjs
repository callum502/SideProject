import { isDeepStrictEqual } from 'node:util';

// The child lists of each record type in the guide tree.
const children = {
  locations: ['boulders', 'photos'],
  boulders: ['problems', 'images', 'videos'],
  problems: [],
  photos: [],
  images: [],
  videos: [],
};
const denied = () => {
  throw Object.assign(
    new Error(
      'You can only edit or remove your own submissions. Parent removal cannot delete other contributors’ submissions.'
    ),
    { status: 403 }
  );
};

// Checks a save against record ownership. Users may change or remove only records they created, and removing a
// record also needs ownership of everything under it; admins may do both. Anyone may add records under another
// user's record. New records are stamped with the user as creator and existing ones keep theirs (`incoming` is
// updated in place).
export function authorizeChanges(current, incoming, user) {
  const allOld = new Set();
  function index(items, type) {
    for (const item of items || []) {
      allOld.add(item.id);
      for (const child of children[type]) index(item[child], child);
    }
  }
  index(current.locations, 'locations');
  function canDelete(item, type) {
    if (user.role === 'admin') return;
    if (item.createdBy !== user.id) denied();
    for (const child of children[type]) for (const nested of item[child] || []) canDelete(nested, child);
  }
  function visit(oldItems, newItems, type) {
    const oldMap = new Map((oldItems || []).map(i => [i.id, i]));
    const nextMap = new Map((newItems || []).map(i => [i.id, i]));
    for (const old of oldItems || []) if (!nextMap.has(old.id)) canDelete(old, type);
    for (const item of newItems || []) {
      const old = oldMap.get(item.id);
      if (!old) {
        if (allOld.has(item.id)) denied(); // Cannot move someone else's record to claim ownership.
        item.createdBy = user.id;
        item.createdByName = user.name;
      } else {
        if (item.createdBy && item.createdBy !== old.createdBy) denied();
        item.createdBy = old.createdBy;
        if (old.createdByName) item.createdByName = old.createdByName;
        else delete item.createdByName;
        const ownFields = value =>
          Object.fromEntries(Object.entries(value).filter(([key]) => !children[type].includes(key)));
        if (user.role !== 'admin' && old.createdBy !== user.id && !isDeepStrictEqual(ownFields(old), ownFields(item)))
          denied();
      }
      for (const child of children[type]) visit(old?.[child], item[child], child);
    }
  }
  visit(current.locations, incoming.locations, 'locations');
}
