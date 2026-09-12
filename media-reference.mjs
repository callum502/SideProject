// App-relative URLs keep database values independent of the project's hostname.
export const BUCKET = 'sideproj-media';
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const file = '[a-f0-9-]+\\.(?:png|jpg|webp|mp4|webm|mov)';
const owner = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function mediaReference(url) {
  if (typeof url !== 'string') return null;
  if (new RegExp('^/media/'+owner+'/'+file+'$').test(url)) return { bucket: BUCKET, path: url.slice(7) };
  return null;
}
export function mediaUrl(bucket, path) {
  const url = bucket === BUCKET ? '/media/'+path : '';
  if (!mediaReference(url)) throw Object.assign(new Error('Invalid media reference.'), { status: 400 });
  return url;
}
