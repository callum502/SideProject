export const LOCATION_MEDIA_LIMIT = 50;
export const MEDIA_LIMIT_MESSAGE = 'This location has a maximum of 50 photos and videos combined, including parking photos. Remove an existing photo or video before adding more.';

export function locationMediaCount(location) {
  return (location.photos || []).length + (location.boulders || []).reduce(
    (total, boulder) => total + (boulder.images || []).length + (boulder.videos || []).length, 0);
}

export function checkMediaCapacity(location, additional) {
  if (locationMediaCount(location) + additional > LOCATION_MEDIA_LIMIT) {
    throw Object.assign(new Error(MEDIA_LIMIT_MESSAGE), { status: 400 });
  }
}

export function enforceMediaLimits(previous, incoming) {
  for (const location of incoming.locations) {
    const old = previous.locations.find(item => item.id === location.id);
    const count = locationMediaCount(location);
    if (count > LOCATION_MEDIA_LIMIT && count > (old ? locationMediaCount(old) : 0)) {
      throw Object.assign(new Error(MEDIA_LIMIT_MESSAGE), { status: 400 });
    }
  }
}
