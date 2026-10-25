import { useEffect, useState } from 'react';
import { api } from './api';

// The signed-in user's logbook: the problems they have logged, and logging or unlogging one.
export function useLogbook(user, logbookPage) {
  const [logs, setLogs] = useState([]),
    [logsLoading, setLogsLoading] = useState(false),
    [logsError, setLogsError] = useState(''),
    [logBusy, setLogBusy] = useState(false);
  // Load the logbook when the user signs in or opens the Logbook page. `active` drops replies from a previous user.
  useEffect(() => {
    let active = true;
    setLogs([]);
    setLogsError('');
    if (user) {
      setLogsLoading(true);
      api('/api/logbook')
        .then(rows => {
          if (active) setLogs(rows);
        })
        .catch(e => {
          if (active) setLogsError(e.message);
        })
        .finally(() => {
          if (active) setLogsLoading(false);
        });
    } else setLogsLoading(false);
    return () => {
      active = false;
    };
  }, [user?.id, logbookPage]);
  async function logProblem(id, completed) {
    setLogBusy(true);
    setLogsError('');
    try {
      setLogs(
        await api('/api/logbook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ problemId: id, completed }),
        })
      );
    } catch (e) {
      setLogsError(e.message);
    } finally {
      setLogBusy(false);
    }
  }
  return { logs, setLogs, logsLoading, logsError, logBusy, logProblem };
}
