import { useMemo } from 'react';
import { useStudio } from '../contexts/StudioContext';

/** The workspace's agents as the insight pages take them: id and name, the same list until one is added, removed or renamed. */
export function useInsightBots(): { id: string; name: string }[] {
  const { agents } = useStudio();
  const key = agents.map((a) => `${a.id}\u0000${a.name}`).join('\u0001');
  return useMemo(
    () =>
      key
        ? key.split('\u0001').map((row) => {
            const [id, name] = row.split('\u0000');
            return { id, name: name || id };
          })
        : [],
    [key]
  );
}
