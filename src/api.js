import { matchesType, SIGNATURE_BYTES } from '../shared/media-signatures.mjs';

// Calls the app's API and returns the parsed JSON reply. Every error that reaches the UI is readable: a dropped
// connection or a non-JSON reply (such as a proxy's HTML error page while the server restarts) would otherwise show
// the browser's raw "Failed to fetch" or a JSON parse error. Cancelled requests still throw an AbortError.
// fallback is the message for an error reply that doesn't explain itself. An error reply's error has its `status`.
export async function api(path, options, fallback = 'Something went wrong. Please try again.') {
  let response;
  try {
    response = await fetch(path, options);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error("Couldn't reach SideProj. Check your connection and try again.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw Object.assign(
      new Error(
        data?.error ||
          (response.status >= 500 ? 'SideProj is having trouble right now. Please try again in a moment.' : fallback)
      ),
      { status: response.status }
    );
  if (data === null) throw new Error('Something went wrong. Please try again.');
  return data;
}

// Whether a chosen file's contents match the type it will be uploaded as, from its first bytes. The server checks
// again when the file is first saved; this only lets the app refuse a bad file before uploading anything.
export async function contentsMatch(file, type) {
  return matchesType(type, new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer()));
}

// Uploads a photo or video and returns its app media URL. The server hands out a one-time Storage URL and the file
// goes there directly, so large videos never pass through SideProj's own server. `type` is the file's MIME type.
export async function uploadFile(file, type) {
  const { uploadUrl, url } = await api('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, size: file.size }),
  });
  // Storage reads the file's type from its form part, and keeps the cache setting for its public link.
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', new Blob([file], { type }));
  let response;
  try {
    response = await fetch(uploadUrl, { method: 'PUT', body: form });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error("Couldn't reach SideProj. Check your connection and try again.");
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // The database's storage quota check is the last word on the 10 GB allowance.
    if (detail.includes('10 GB upload allowance'))
      throw new Error('This upload would exceed your 10 GB upload allowance.');
    if (response.status === 413) throw new Error('File exceeds the Supabase Storage size limit.');
    throw new Error('The upload failed. Please try again.');
  }
  return { url };
}
