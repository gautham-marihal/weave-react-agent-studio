import { useCallback } from 'react';
import { api } from '../../api/client.ts';
import { usePref } from '../usePref.js';
import { useAsync } from '../useAsync.js';
import { isFinished, normalizeHeadline } from '../scenarios/runResults.js';
import { gateCheck } from './gateCheck.js';

// "Tests must pass before publishing" is a choice one person makes for one agent, kept in this browser (see gateCheck.js for what it means).
const keyOf = (botId) => `weave_gate_${botId}`;
export function useGate(botId) {
  const [value, set] = usePref(keyOf(botId), '0');
  const setOn = useCallback((on) => set(on ? '1' : '0'), [set]);
  return [value === '1', setOn];
}

// Where the gate stands for an agent's draft: { enabled, check: { ok, why, action }, loading, reload }.
export function useGateStatus(botId, editor) {
  const [enabled] = useGate(botId);
  const runs = useAsync((signal) => (enabled ? api.listTestRuns(botId, 20, { signal }) : Promise.resolve([])), [botId, enabled]);
  const latest = Array.isArray(runs.data) ? runs.data.map(normalizeHeadline).find((run) => isFinished(run.status)) || null : null;
  const scenarioCount = Array.isArray(editor?.parsed?.value?.tests) ? editor.parsed.value.tests.length : 0;
  const check = gateCheck({ enabled, scenarioCount, latestRun: latest, savedAt: editor?.meta?.savedAt || '', dirty: !!editor?.dirty });
  return { enabled, check, loading: enabled && runs.loading && !runs.data, reload: runs.reload };
}
