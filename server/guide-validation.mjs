// Checks on a merged guide before it is saved (see checkGuide).
import { validLocationLinks } from '../shared/location-links.mjs';
import { duplicateMediaName } from '../shared/media-names.mjs';
import { mediaReference } from './media-reference.mjs';
import { fail } from './http.mjs';

// A string of at most `max` characters; when required, it must not be blank.
const text = (value, max, required = false) =>
  typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0);

// Marks drawn on a photo. Coordinates are on a 0–1000 scale across the photo's width and height.
function validateAnnotations(annotations) {
  if (!Array.isArray(annotations) || annotations.length > 1000) throw fail('Invalid annotations.');
  const coord = n => Number.isFinite(n) && n >= 0 && n <= 1000;
  for (const a of annotations) {
    if (!a || typeof a !== 'object') throw fail('Invalid annotation.');
    if (!['box', 'line', 'freehand', 'arrow'].includes(a.type)) throw fail('Unknown annotation tool.');
    if (a.color !== undefined && !['green', 'red'].includes(a.color)) throw fail('Unknown annotation colour.');
    if (a.type === 'freehand') {
      if (
        !Array.isArray(a.points) ||
        a.points.length > 20000 ||
        !a.points.every(p => Array.isArray(p) && p.length === 2 && p.every(coord))
      )
        throw fail('Invalid freehand annotation.');
    } else if (![a.x, a.y, a.x2, a.y2].every(coord)) throw fail('Invalid annotation coordinates.');
  }
}

// A problem's annotations must be for photos on its boulder. Only keys a save adds are refused: older data may still
// hold annotations for since-removed photos, and refusing those would block every save to the guide.
function validateAnnotationTargets(data, previous) {
  const oldKeys = new Map();
  for (const location of previous.locations)
    for (const boulder of location.boulders)
      for (const problem of boulder.problems || [])
        oldKeys.set(problem.id, new Set(Object.keys(problem.photoAnnotations || {})));
  for (const location of data.locations)
    for (const boulder of location.boulders) {
      const photos = new Set(boulder.images.map(image => image.id));
      for (const problem of boulder.problems || []) {
        for (const id of Object.keys(problem.photoAnnotations || {}))
          if (!photos.has(id) && !oldKeys.get(problem.id)?.has(id))
            throw fail('Problem annotations must be for photos on this boulder.');
      }
    }
}

// Length limits for names and notes. Text saved before a limit was introduced can stay as it is,
// so only a field that is new or changed is checked.
function validateContentLengths(data, previous) {
  const oldRecords = new Map();
  for (const location of previous.locations) {
    oldRecords.set(location.id, location);
    for (const boulder of location.boulders) {
      oldRecords.set(boulder.id, boulder);
      for (const problem of boulder.problems || []) oldRecords.set(problem.id, problem);
    }
  }
  const check = (record, field, limit, label) => {
    if (
      typeof record[field] === 'string' &&
      record[field].length > limit &&
      record[field] !== oldRecords.get(record.id)?.[field]
    )
      throw fail(label + ' must be no more than ' + limit + ' characters.');
  };
  for (const location of data.locations) {
    check(location, 'name', 80, 'Location name');
    for (const boulder of location.boulders) {
      check(boulder, 'name', 80, 'Boulder name');
      check(boulder, 'notes', 800, 'Finding the Boulder');
      check(boulder, 'otherNotes', 800, 'Other Notes');
      for (const problem of boulder.problems || []) {
        check(problem, 'name', 80, 'Problem name');
        check(problem, 'description', 800, 'Problem description');
      }
    }
  }
}

// Structure and size checks for the whole guide: unique record IDs, required fields, coordinates in range, media
// that points at our storage, unique media names, and problem attachments that belong to the problem's boulder.
function validate(data) {
  if (!Array.isArray(data.locations) || data.locations.length > 1000) throw fail('Invalid guide.');
  const ids = new Set();
  const id = value => {
    if (!text(value, 100, true) || ids.has(value)) throw fail('Invalid or duplicate record ID.');
    ids.add(value);
  };
  for (const l of data.locations) {
    id(l.id);
    if (!validLocationLinks(l.links || [])) throw fail('Links need a label and a valid HTTP or HTTPS URL.');
    if (!text(l.name, 120, true) || !text(l.approach, 10000) || !Array.isArray(l.boulders) || l.boulders.length > 1000)
      throw fail('Invalid location.');
    if (!text(l.latitude, 32) || !text(l.longitude, 32) || !!l.latitude !== !!l.longitude)
      throw fail('Provide both coordinates.');
    if (
      l.latitude &&
      (!Number.isFinite(+l.latitude) ||
        Math.abs(+l.latitude) > 90 ||
        !Number.isFinite(+l.longitude) ||
        Math.abs(+l.longitude) > 180)
    )
      throw fail('Coordinates are outside the valid range.');
    if (l.photos !== undefined && (!Array.isArray(l.photos) || l.photos.length > 200))
      throw fail('Invalid location photos.');
    for (const photo of l.photos || []) {
      id(photo.id);
      if (
        !text(photo.name, 255, true) ||
        !text(photo.caption || '', 2000) ||
        !mediaReference(photo.url) ||
        !/\.(png|jpg|webp)$/.test(photo.url)
      )
        throw fail('Invalid location photo.');
    }
    if (
      duplicateMediaName(
        [],
        (l.photos || []).map(p => p.name)
      ) !== null
    )
      throw fail('Photo names must be unique within this location.');
    for (const b of l.boulders) {
      id(b.id);
      if (
        !text(b.name, 120, true) ||
        !text(b.notes, 10000) ||
        (b.otherNotes !== undefined && !text(b.otherNotes, 10000)) ||
        !Array.isArray(b.images) ||
        b.images.length > 200
      )
        throw fail('Invalid boulder.');
      if (b.videos !== undefined && (!Array.isArray(b.videos) || b.videos.length > 200)) throw fail('Invalid videos.');
      if (b.problems !== undefined && (!Array.isArray(b.problems) || b.problems.length > 1000))
        throw fail('Invalid problems.');
      for (const [kind, media] of [
        ['photo', b.images],
        ['video', b.videos || []],
      ]) {
        if (media.some(item => !item || !text(item.name, 255, true))) throw fail('Enter a valid media name.');
        const duplicate = duplicateMediaName(
          [],
          media.map(item => item.name)
        );
        if (duplicate !== null)
          throw fail(`A ${kind} named "${duplicate}" already exists on this boulder. Choose a different name.`);
      }
      for (const problem of b.problems || []) {
        id(problem.id);
        if (!text(problem.name, 120, true) || !text(problem.grade, 40, true) || !text(problem.description, 10000, true))
          throw fail('A problem needs a name, grade, and description.');
        if (problem.photoAnnotations !== undefined) {
          if (
            !problem.photoAnnotations ||
            typeof problem.photoAnnotations !== 'object' ||
            Array.isArray(problem.photoAnnotations) ||
            Object.keys(problem.photoAnnotations).length > 200
          )
            throw fail('Invalid problem annotations.');
          for (const [imageId, annotations] of Object.entries(problem.photoAnnotations)) {
            validateAnnotations(annotations);
          }
        }
        for (const [field, media] of [
          ['imageIds', b.images],
          ['videoIds', b.videos || []],
        ]) {
          if (
            !Array.isArray(problem[field]) ||
            problem[field].length > 200 ||
            new Set(problem[field]).size !== problem[field].length ||
            !problem[field].every(id => media.some(item => item.id === id))
          )
            throw fail('Problem attachments must belong to this boulder.');
        }
      }
      for (const video of b.videos || []) {
        id(video.id);
        if (!text(video.name, 255, true) || !mediaReference(video.url) || !/\.(mp4|webm|mov)$/.test(video.url))
          throw fail('Invalid video.');
      }
      for (const image of b.images) {
        id(image.id);
        if (
          !text(image.name, 255, true) ||
          !mediaReference(image.url) ||
          !/\.(png|jpg|webp)$/.test(image.url) ||
          !Array.isArray(image.annotations) ||
          image.annotations.length > 1000 ||
          (image.onBoulderPage !== undefined && typeof image.onBoulderPage !== 'boolean')
        )
          throw fail('Invalid image.');
        validateAnnotations(image.annotations);
      }
    }
  }
}

// Every check a save's merged guide must pass. `current` is the guide the changes were applied to.
export function checkGuide(next, current) {
  validate(next);
  validateContentLengths(next, current);
  validateAnnotationTargets(next, current);
}
