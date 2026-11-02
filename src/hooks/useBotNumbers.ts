import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { readNumbers } from '../models/channels';

// The phone numbers an agent is reached on (GET /bots/{id}/numbers), read when asked for (the agent has a phone line).
// A server with no phone system answers 503: that is said as "not available", not as an error.

export type BotNumbersState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; numbers: { number: string; environment: string }[] }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

export function useBotNumbers(botId: string, enabled: boolean) {
  const [state, setState] = useState<BotNumbersState>({ status: 'idle' });
  const run = useRef(0);
  const load = useCallback(async () => {
    if (!botId) return;
    const mine = (run.current += 1);
    setState((old) => (old.status === 'ready' ? old : { status: 'loading' }));
    try {
      const raw: unknown = await api.listBotNumbers(botId);
      if (mine === run.current) setState({ status: 'ready', numbers: readNumbers(raw) });
    } catch (err: unknown) {
      if (mine !== run.current) return;
      if (err instanceof ApiError && err.status === 503) setState({ status: 'unavailable' });
      else setState({ status: 'error', message: err instanceof Error ? err.message : 'The numbers could not be read.' });
    }
  }, [botId]);
  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);
  return { state, reload: load };
}
