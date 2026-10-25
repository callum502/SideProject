import { checkGuide } from '../guide-validation.mjs';
import { fail, readJson, requireContributor, uuidPattern } from '../http.mjs';

// Browser tests read and edit the whole guide directly to set up and check their data, so their server sets
// E2E_FULL_GUIDE=1. Allowed only outside production and against local Supabase; any other setup refuses to start.
export function fullGuideOption(env) {
  if (env.E2E_FULL_GUIDE !== '1') return false;
  if (env.NODE_ENV === 'production' || env.RENDER === 'true')
    throw new Error('E2E_FULL_GUIDE must not be set in production.');
  let host;
  try {
    host = new URL(env.SUPABASE_URL).hostname;
  } catch {}
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host))
    throw new Error('E2E_FULL_GUIDE requires SUPABASE_URL to point to local Supabase.');
  return true;
}

// The guide: the list of locations for search and the map, each location as it is opened, and saving changes.
// With `fullGuide`, anyone may read or save the whole guide at once, as admins can (see fullGuideOption).
export function guideRoutes({ contentStore, fullGuide }) {
  // Reading or saving the whole guide at once costs as much as the whole site, so only admins (and browser tests,
  // with fullGuide) may; the app works one location at a time.
  const wholeGuide = user => fullGuide || user?.role === 'admin';
  const readToken = (user, session) => (user ? session.accessToken : undefined);
  return [
    {
      method: 'GET',
      path: '/api/guide',
      async handle({ json, user, session }) {
        if (!wholeGuide(user)) throw fail('Not found.', 404);
        return json(200, await contentStore.read(readToken(user, session)));
      },
    },
    {
      method: 'GET',
      path: '/api/locations',
      handle: async ({ json, user, session }) => json(200, await contentStore.summaries(readToken(user, session))),
    },
    {
      method: 'GET',
      path: /^\/api\/locations\/(.+)$/,
      async handle({ json, params: [id], user, session }) {
        const guide = uuidPattern.test(id)
          ? await contentStore.readLocation(id, readToken(user, session))
          : { locations: [] };
        if (!guide.locations.length) throw fail('Location not found.', 404);
        return json(200, guide);
      },
    },
    {
      method: 'PUT',
      path: '/api/guide',
      async handle({ req, json, user, session }) {
        requireContributor(user);
        const data = await readJson(req, 12 * 1024 * 1024, 'Invalid JSON.', { keepStatus: true });
        if (!data || !Array.isArray(data.changes)) throw fail('Invalid changes.');
        // `location` limits the save to one location, and the reply to that location (none once it is removed).
        if (
          data.location === undefined
            ? !wholeGuide(user)
            : !(typeof data.location === 'string' && uuidPattern.test(data.location))
        )
          throw fail('Invalid location.');
        // Changes are applied to the latest guide; the merged result must pass the same checks as a full guide.
        return json(200, await contentStore.save(data.changes, user, session.accessToken, checkGuide, data.location));
      },
    },
  ];
}
