import { api } from '../../api/client.js';
import { useAsync } from '../useAsync.js';

// The newest published version of an agent and its configuration, for comparing the draft with. { version, config } or null when nothing is published yet.
export function useLatestPublished(botId, refreshKey = 0) {
  const state = useAsync(
    async (signal) => {
      const list = await api.listVersions(botId, { signal });
      const latest = Array.isArray(list) ? list[0] : null;
      if (!latest) return null;
      const record = await api.getVersion(botId, latest.version, { signal });
      return { version: latest.version, config: record?.config || null };
    },
    [botId, refreshKey],
  );
  return { published: state.data, loading: state.loading, error: state.error, reload: state.reload };
}
