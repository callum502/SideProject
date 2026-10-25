import { randomUUID } from 'node:crypto';
import { mediaReference } from '../media-reference.mjs';
import { fail, readJson, requireContributor } from '../http.mjs';

// The file extension each upload type is stored with.
const uploadExtensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

// Starting uploads, discarding uploads that were never saved, and the user's storage allowance.
export function uploadRoutes({ storage }) {
  return [
    {
      method: 'GET',
      path: '/api/storage/usage',
      async handle({ json, user, session }) {
        if (!user) throw fail('Log in first.', 401);
        return json(200, await storage.usage(session.accessToken));
      },
    },
    // Starts an upload: the browser then sends the file straight to Storage at the returned uploadUrl, so its bytes
    // never pass through this server. Its contents are checked when a save first uses it (content-store.mjs).
    {
      method: 'POST',
      path: '/api/uploads',
      async handle({ req, json, user, session }) {
        requireContributor(user);
        const values = await readJson(req, 1024, 'Invalid upload.');
        const extension = uploadExtensions[values?.type];
        if (!extension)
          throw fail(
            String(values?.type).startsWith('video/')
              ? 'Choose MP4, WebM, or MOV videos.'
              : 'Choose JPEG, PNG, or WebP images.'
          );
        if (!Number.isSafeInteger(values.size) || values.size <= 0) throw fail('Invalid upload.');
        const filename = `${randomUUID()}.${extension}`;
        return json(
          201,
          await storage.signUpload(user.id + '/' + filename, values.size, values.type, session.accessToken)
        );
      },
    },
    // Delete the user's own uploads from a batch that didn't save, so they don't use up the storage allowance.
    // Storage only deletes files nothing uses (sideproj_remove_unused), so a file already in the guide is kept.
    {
      method: 'POST',
      path: '/api/uploads/discard',
      async handle({ req, json, user, session }) {
        if (!user) throw fail('Log in first.', 401);
        const values = await readJson(req, 16384, 'Invalid uploads.');
        const urls = values?.urls;
        if (!Array.isArray(urls) || !urls.length || urls.length > 50) throw fail('Invalid uploads.');
        const paths = urls.map(u => (typeof u === 'string' ? mediaReference(u)?.path : null));
        if (paths.some(p => !p || p.split('/')[0] !== user.id))
          throw fail('You can only discard your own uploads.', 403);
        return json(200, { removed: await storage.remove(paths, session.accessToken) });
      },
    },
  ];
}
