import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client.ts';

// The kinds of personal detail the server's redaction can find (GET /redaction/entities): read once per session and
// shared. null until it answers (or if it can't): the checkboxes then use the studio's own list (afterCallModel.js).
export function useRedactionKinds() {
  const query = useQuery({
    queryKey: ['redactionEntities'],
    queryFn: async () => {
      const answer = await api.redactionEntities();
      const rows = Array.isArray(answer?.entities) ? answer.entities : Array.isArray(answer) ? answer : [];
      return rows.filter((r) => r && typeof r.kind === 'string' && r.kind);
    },
    staleTime: Infinity,
    retry: false,
  });
  return query.data && query.data.length ? query.data : null;
}
