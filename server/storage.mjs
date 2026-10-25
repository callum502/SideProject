import { loadEnv } from 'vite';
import { BUCKET, mediaReference, mediaUrl } from './media-reference.mjs';
import { maxBytes, tooLargeMessage } from '../shared/media-limits.mjs';
const fail = (message, status = 503) => Object.assign(new Error(message), { status });

// Supabase Storage client for guide media. Requests carry the user's access token, so Storage policies apply.
export function createStorage({
  env = { ...loadEnv('development', process.cwd(), ''), ...process.env },
  fetchImpl = fetch,
} = {}) {
  const base = env.SUPABASE_URL?.replace(/\/$/, '');
  function objectPath(path) {
    if (!mediaReference('/media/' + path)) throw fail('Invalid Storage path.', 400);
    return `${BUCKET}/${path}`;
  }
  async function request(route, token, options = {}) {
    if (!base || !env.SUPABASE_PUBLISHABLE_KEY) throw fail('Configure Supabase Storage first.');
    try {
      return await fetchImpl(base + '/storage/v1/' + route, {
        ...options,
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, ...options.headers },
        signal: AbortSignal.timeout(180000),
      });
    } catch {
      throw fail('Storage request could not be confirmed. You can retry; existing files are not overwritten.');
    }
  }
  // Turns a failed Storage response into an error with a user-facing message.
  async function check(response) {
    if (response.ok) return;
    const detail = await response.json().catch(() => null);
    if (JSON.stringify(detail).includes('10 GB upload allowance'))
      throw fail('This upload would exceed your 10 GB upload allowance.', 400);
    if (response.status === 413) throw fail('File exceeds the Supabase Storage size limit.', 413);
    if (response.status === 401 || response.status === 403)
      throw fail('Storage access was denied. Check your login and the Storage migration.', 403);
    throw fail('Storage request failed. Check the bucket, policies and file-size settings.');
  }
  // The user's stored bytes and their 10 GB allowance, from the my_storage_usage database function.
  async function usage(token) {
    if (!base || !env.SUPABASE_PUBLISHABLE_KEY) throw fail('Configure Supabase Storage first.');
    let response;
    try {
      response = await fetchImpl(base + '/rest/v1/rpc/my_storage_usage', {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_PUBLISHABLE_KEY,
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw fail('Could not check your upload allowance. Please try again.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw fail(
        data?.code === 'PGRST202'
          ? 'Apply the user storage limit SQL migration before uploading.'
          : 'Could not check your upload allowance. Please try again.'
      );
    if (!Number.isSafeInteger(data?.usedBytes) || data.usedBytes < 0 || data.limitBytes !== 10000000000)
      throw fail('Could not verify your upload allowance.');
    return data;
  }
  const publicUrl = path => `${base}/storage/v1/object/public/${objectPath(path)}`;
  return {
    publicUrl,
    usage,
    // Delete files of removed photos and videos. Storage only deletes those the user may delete and nothing still
    // uses (see the sideproj_remove_unused policy); others are skipped. Returns how many were deleted.
    async remove(paths, token) {
      if (!paths.length) return 0;
      const r = await request('object/' + BUCKET, token, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths.map(p => objectPath(p).slice(BUCKET.length + 1)) }),
      });
      await check(r);
      return (await r.json().catch(() => [])).length;
    },
    // Size, type and leading bytes of a stored file. Only the first `head` bytes are downloaded, so its type can be
    // checked against its contents without fetching a whole video.
    async inspect(path, token, head) {
      const r = await request('object/authenticated/' + objectPath(path), token, {
        headers: { Range: `bytes=0-${head - 1}` },
      });
      await check(r);
      // A ranged reply gives the full size after the slash in Content-Range; a whole-file reply in Content-Length.
      const size = Number(r.headers.get('content-range')?.split('/')[1] ?? r.headers.get('content-length'));
      if (!Number.isSafeInteger(size) || size <= 0) throw fail('Could not verify the uploaded file size.');
      const chunks = [];
      let read = 0;
      const reader = r.body.getReader();
      while (read < head) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        read += value.length;
      }
      await reader.cancel().catch(() => {});
      return {
        size,
        mime: r.headers.get('content-type')?.split(';')[0],
        bytes: Buffer.concat(chunks).subarray(0, head),
      };
    },
    // A one-time URL the browser uploads the file to directly, so its bytes never pass through this server. Checked
    // against the allowance first; Storage refuses to overwrite an existing file and rechecks the allowance itself.
    async signUpload(path, size, mime, token) {
      if (size > maxBytes(mime)) throw fail(tooLargeMessage(mime), 413);
      objectPath(path);
      const allowance = await usage(token);
      if (allowance.usedBytes + size > allowance.limitBytes)
        throw fail('This upload would exceed your 10 GB upload allowance.', 400);
      const r = await request('object/upload/sign/' + objectPath(path), token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-upsert': 'false' },
        body: '{}',
      });
      await check(r);
      const signed = await r.json().catch(() => null);
      if (typeof signed?.url !== 'string' || !signed.url.startsWith('/object/upload/sign/'))
        throw fail('Storage did not return an upload URL.');
      return { uploadUrl: base + '/storage/v1' + signed.url, url: mediaUrl(BUCKET, path) };
    },
  };
}
