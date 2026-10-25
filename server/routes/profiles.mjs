import { maxBytes, tooLargeMessage } from '../../shared/media-limits.mjs';
import { matchesType, SIGNATURE_BYTES } from '../../shared/media-signatures.mjs';
import { mediaReference } from '../media-reference.mjs';
import { fail, readJson, uuidPattern } from '../http.mjs';

// Profile details, profile photos and public profiles.
export function profileRoutes({ auth, storage }) {
  return [
    {
      method: 'POST',
      path: '/api/profile',
      async handle({ req, json, user, session }) {
        if (!user) throw fail('Log in first.', 401);
        const values = await readJson(req, 4096, 'Invalid profile details.');
        if (!values || typeof values !== 'object') throw fail('Invalid profile details.');
        const updated = await auth.completeProfile(values, session);
        session.user = updated;
        return json(200, { user: updated });
      },
    },
    {
      method: 'GET',
      path: '/api/profile-photo',
      async handle({ res, url, json }) {
        const id = url.searchParams.get('id');
        if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw fail('Invalid profile.', 400);
        const path = await auth.profilePhoto(id);
        if (!path) return json(404, { error: 'No profile photo.' });
        res.writeHead(302, { Location: storage.publicUrl(path), 'Cache-Control': 'no-store' });
        return res.end();
      },
    },
    {
      method: 'POST',
      path: '/api/profile-photo',
      async handle({ req, json, user, session }) {
        if (!user) throw fail('Log in first.', 401);
        const values = await readJson(req, 2048, 'Invalid photo.');
        const ref = typeof values?.url === 'string' ? mediaReference(values.url) : null;
        if (values?.url !== null && (!ref || !/\.(jpg|png|webp)$/.test(ref.path) || ref.path.split('/')[0] !== user.id))
          throw fail('Choose an image uploaded by your account.', 400);
        // The browser uploaded the file straight to Storage, so check here that it really is an image.
        if (ref) {
          const info = await storage.inspect(ref.path, session.accessToken, SIGNATURE_BYTES);
          const expected = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ref.path.split('.').pop()];
          if (info.mime !== expected || !matchesType(expected, info.bytes))
            throw fail('The file is not a supported image.');
          if (info.size > maxBytes(expected)) throw fail(tooLargeMessage(expected), 413);
        }
        const previous = await auth.profilePhoto(user.id).catch(() => null);
        await auth.setProfilePhoto(ref?.path || null, session);
        // A replaced or removed photo's file would otherwise stay stored, using the allowance. Storage keeps it if
        // something still uses it (such as a guide photo). The change is saved either way; a failure is only logged.
        if (previous && previous !== ref?.path)
          await storage
            .remove([previous], session.accessToken)
            .catch(error => console.error('Could not delete the previous profile photo:', error.message));
        return json(200, { saved: true });
      },
    },
    {
      method: 'GET',
      path: '/api/public-profile',
      async handle({ url, json }) {
        const id = url.searchParams.get('id');
        if (!id || !uuidPattern.test(id)) throw fail('Profile not found.', 404);
        const profile = await auth.publicProfile(id);
        if (!profile) throw fail('Profile not found.', 404);
        return json(200, { ...profile, hasPhoto: !!(await auth.profilePhoto(id)) });
      },
    },
  ];
}
