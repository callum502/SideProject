import { fail, readJson, uuidPattern } from '../http.mjs';

const friendActions = ['list', 'search', 'suggest', 'request', 'accept', 'decline', 'remove', 'logbook'];

// Friends (invites, search and friends' logbooks) and the user's own logbook.
export function friendRoutes({ auth }) {
  return [
    {
      method: 'POST',
      path: '/api/friends',
      async handle({ req, json, user, session }) {
        if (!user) throw fail('Log in to use Friends.', 401);
        const values = await readJson(req, 2048, 'Invalid friend request.');
        if (!values || !friendActions.includes(values.action)) throw fail('Invalid friend action.');
        if (
          ['search', 'suggest'].includes(values.action) &&
          (typeof values.name !== 'string' || !values.name.trim() || values.name.length > 120)
        )
          throw fail('Enter a display name.');
        if (
          !['list', 'search', 'suggest'].includes(values.action) &&
          (typeof values.target !== 'string' || !uuidPattern.test(values.target))
        )
          throw fail('Choose a valid account.');
        try {
          return json(200, await auth.friends(session, values));
        } catch (e) {
          // Refusals (inviting yourself, the invite limit, a non-friend's logbook, an expired session)
          // keep their own message.
          if (e.status >= 400 && e.status < 500) throw e;
          throw fail('Could not update Friends. Please try again in a moment.', 503);
        }
      },
    },
    {
      method: ['GET', 'POST'],
      path: '/api/logbook',
      async handle({ req, json, user, session }) {
        if (!user) throw fail('Log in to use your logbook.', 401);
        let values;
        if (req.method === 'POST') {
          values = await readJson(req, 1024, 'Invalid log entry.');
          if (
            !values ||
            typeof values.completed !== 'boolean' ||
            typeof values.problemId !== 'string' ||
            !uuidPattern.test(values.problemId)
          )
            throw fail('Invalid log entry.');
        }
        try {
          return json(200, await auth.logbook(session, values));
        } catch (e) {
          // Errors meant for the user (a removed problem, an expired session) keep their own message.
          if (e.status >= 400 && e.status < 500) throw e;
          throw fail(
            'Could not load or save your logbook. Check your connection and that the logbook SQL migration has been applied.',
            503
          );
        }
      },
    },
  ];
}
