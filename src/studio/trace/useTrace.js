import { useEffect, useState } from 'react';
import { followCall } from '../../api/client.js';

// The records of the conversation a Test tab (or preview) is having. A simulated conversation makes its own records; a real one is
// followed through the API's live stream of the call, which the runtime writes as it goes. Reading the stream never changes anything.
export function useTrace({ botId, session }) {
  const simulated = !!session.simulated;
  const room = session.info?.room;
  const [records, setRecords] = useState([]);
  const [following, setFollowing] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    setRecords([]); setProblem('');
    if (simulated || !room) { setFollowing(false); return undefined; }
    setFollowing(true);
    const stop = followCall(botId, room, {
      onRecord: (record) => setRecords((old) => (old.some((r) => r.seq === record.seq) ? old : [...old, record])),
      onEnd: () => setFollowing(false),
      onError: () => { setFollowing(false); setProblem('The live trace stopped. The runtime may not have written anything yet, or the connection to the API was cut.'); },
    });
    return () => { stop(); setFollowing(false); };
  }, [botId, room, simulated]);

  if (simulated) return { records: session.records || [], following: ['waiting', 'live'].includes(session.status), problem: '' };
  return { records, following, problem };
}
