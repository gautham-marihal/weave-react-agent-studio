import React, { useEffect, useMemo, useState } from 'react';
import type { AgentConfig } from '../../../../types/studio';
import { api } from '../../../../api/client';
import { normalizePrompt, promptRequest, whatIfValue, whatIfVariables, withLocalOffset, type Prompt, type WhatIfVariable } from '../../../../models/promptPreview';
import { toast } from '../../../ui/Toast';

// The state behind the prompt preview (inline on the Agent page, and the dialog from the agent's header): the what-if
// choices, and the server's answer for them.

// ---- the "what if" choices -------------------------------------------------------------------------------------------
export interface WhatIfChoices {
  agent: string;
  setAgent: (v: string) => void;
  channel: string;
  setChannel: (v: string) => void;
  nowLocal: string;
  setNowLocal: (v: string) => void;
  callerPhone: string;
  setCallerPhone: (v: string) => void;
  typed: Record<string, string>;
  setTyped: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  variables: WhatIfVariable[];
  state: Record<string, unknown>;
  changed: boolean;
  reset: () => void;
}

/** The what-ifs the server's preview takes: agent, channel, time, the caller's number, a few state values. */
export function useWhatIf(config: AgentConfig | null): WhatIfChoices {
  const [agent, setAgent] = useState('');
  const [channel, setChannel] = useState('');
  const [nowLocal, setNowLocal] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [typed, setTyped] = useState<Record<string, string>>({});
  const variables = useMemo(() => whatIfVariables(config), [config]);
  const state = useMemo(
    () => Object.fromEntries(variables.map((v) => [v.name, whatIfValue(v.type, typed[v.name])]).filter(([, value]) => value !== undefined)),
    [variables, typed]
  );
  const changed = !!agent || !!channel || !!nowLocal || !!callerPhone.trim() || Object.keys(state).length > 0;
  const reset = () => {
    setAgent('');
    setChannel('');
    setNowLocal('');
    setCallerPhone('');
    setTyped({});
  };
  return { agent, setAgent, channel, setChannel, nowLocal, setNowLocal, callerPhone, setCallerPhone, typed, setTyped, variables, state, changed, reset };
}

// ---- asking the server ------------------------------------------------------------------------------------------------
export interface PromptAnswer {
  data: Prompt | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * The exact prompt from the server (POST /preview/prompt) for what is in the editor now, asked 300 ms after the last
 * change. When the server can't answer, the error is shown: nothing is put together in the browser instead.
 */
export function usePromptPreview(config: AgentConfig | null, what: WhatIfChoices, enabled: boolean): PromptAnswer {
  const [data, setData] = useState<Prompt | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const stateKey = JSON.stringify(what.state);
  useEffect(() => {
    if (!enabled || !config) return undefined;
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      const body = promptRequest(config, { agent: what.agent, channel: what.channel, state: what.state, now: withLocalOffset(what.nowLocal), callerPhone: what.callerPhone });
      api
        .previewPrompt(body, { signal: controller.signal })
        .then((raw) => {
          if (controller.signal.aborted) return;
          setData(normalizePrompt(raw));
          setError(null);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setData(null);
          setError(err instanceof Error ? err.message : 'The server could not build the preview.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // the config is compared by identity: it changes when something in it does
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, config, what.agent, what.channel, what.nowLocal, what.callerPhone, stateKey, attempt]);
  return { data, loading, error, retry: () => setAttempt((n) => n + 1) };
}

export const copyInstructions = (text: string) =>
navigator.clipboard.writeText(text).then(
  () => toast.success('Instructions copied'),
  () => toast.error('Could not copy to the clipboard')
);
