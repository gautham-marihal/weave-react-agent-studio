import { api } from '../../api/client.ts';
import { useAsync } from '../useAsync.js';

// The newest published version and its config, to compare the draft with: { version, config }, or null if none.
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
