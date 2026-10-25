// The largest photo and video, in MB. The media table's SQL checks and the Storage bucket's size limit hold the same
// sizes as a backstop.
export const IMAGE_MAX_MB = 8;
export const VIDEO_MAX_MB = 100;
// The size limit for a file of this MIME type, in bytes, and the error for a file over it.
export const maxBytes = mime => (mime.startsWith('image/') ? IMAGE_MAX_MB : VIDEO_MAX_MB) * 1024 * 1024;
export const tooLargeMessage = mime =>
  `File is too large (${mime.startsWith('image/') ? IMAGE_MAX_MB : VIDEO_MAX_MB} MB maximum).`;

// A location holds at most 50 photos and videos in total: its own photos (such as parking) plus every boulder's.
export const LOCATION_MEDIA_LIMIT = 50;
export const MEDIA_LIMIT_MESSAGE =
  'This location has a maximum of 50 photos and videos combined, including parking photos. Remove an existing photo or video before adding more.';

export function locationMediaCount(location) {
  return (
    (location.photos || []).length +
    (location.boulders || []).reduce(
      (total, boulder) => total + (boulder.images || []).length + (boulder.videos || []).length,
      0
    )
  );
}

// Checked in the browser before uploading `additional` files to a location.
export function checkMediaCapacity(location, additional) {
  if (locationMediaCount(location) + additional > LOCATION_MEDIA_LIMIT) {
    throw Object.assign(new Error(MEDIA_LIMIT_MESSAGE), { status: 400 });
  }
}

// Checked on save. A location already over the limit can still be saved, as long as its count does not grow.
export function enforceMediaLimits(previous, incoming) {
  for (const location of incoming.locations) {
    const old = previous.locations.find(item => item.id === location.id);
    const count = locationMediaCount(location);
    if (count > LOCATION_MEDIA_LIMIT && count > (old ? locationMediaCount(old) : 0)) {
      throw Object.assign(new Error(MEDIA_LIMIT_MESSAGE), { status: 400 });
    }
  }
}
