import React, { useMemo } from 'react';
import { api } from '../api/client.ts';
import { useAgentHealth } from '../studio/health/useAgentHealth.js';
import { useKnowledge } from '../studio/knowledge/useKnowledge.js';
import { readinessSteps, stepRoute } from '../studio/agent/readiness.js';
import { useGate } from '../studio/release/gate.js';
import { isFinished, normalizeHeadline } from '../studio/scenarios/runResults.js';
import { useAsync } from '../studio/useAsync.js';

// Home's "what now?", at the foot of its alerts card: the agent you last worked on, how far it is from ready
// ("Acme is 6 of 7 steps ready · Finish"), and the next step to open. The steps come from readiness.js with the same
// inputs as the agent's menu and Overview, so they always agree.
const LAST_KEY = 'weave_last_agent';
export const rememberAgent = (botId) => {
  try {
    localStorage.setItem(LAST_KEY, botId);
  } catch {
    /* storage unavailable */
  }
};
const lastAgent = () => {
  try {
    return localStorage.getItem(LAST_KEY) || '';
  } catch {
    return '';
  }
};

//   onOpenTab(botId, tab, params): opens a page of the agent (a step's page, with the panel to open)
export default function HomeJourney({ bots, onOpenTab }) {
  const list = useMemo(() => (Array.isArray(bots) ? bots : []), [bots]);
  const remembered = lastAgent();
  const bot = useMemo(
    () => list.find((b) => b.id === remembered) || [...list].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0] || null,
    [list, remembered],
  );
  const visible = useMemo(() => (bot ? [bot] : []), [bot]);
  const { meta } = useAgentHealth(visible);
  const answer = bot ? meta[bot.id] || null : null;
  // runs of the shown agent only: an answer kept for another agent (while loading, or after a failure) is ignored
  const runs = useAsync(async (signal) => (bot ? { bot: bot.id, list: await api.listTestRuns(bot.id, 20, { signal }) } : null), [bot?.id]);
  const runsHere = runs.data && runs.data.bot === bot?.id && !runs.loading ? runs.data.list : undefined;
  const latestRun = useMemo(
    () => (Array.isArray(runsHere) ? runsHere.map(normalizeHeadline).find((run) => isFinished(run.status)) || null : undefined),
    [runsHere],
  );
  const [gateOn] = useGate(bot?.id || '');
  const config = answer?.config || null;
  // what the server has read of its documents, so this matches its menu
  const knowledge = useKnowledge(Array.isArray(config?.knowledge) && config.knowledge.length ? bot.id : null);
  const plan = useMemo(
    () =>
      config
        ? readinessSteps({
            config,
            summary: bot,
            report: answer?.report || null,
            scenarioCount: Array.isArray(config.tests) ? config.tests.length : 0,
            latestRun,
            gate: gateOn ? { enabled: true, savedAt: bot?.updated_at || '', dirty: false } : null,
            knowledgeRead: knowledge.data,
          })
        : null,
    [config, bot, answer?.report, latestRun, gateOn, knowledge.data],
  );

  if (!bot) return null;
  const name = bot.name || bot.id;
  const open = (step) => {
    const { tab, params } = stepRoute(step);
    onOpenTab(bot.id, tab, params);
  };
  const ready = !!plan && plan.total > 0 && !plan.next;
  const pct = plan?.total ? Math.round((plan.done / plan.total) * 100) : 0;

  return (
    <div className="cvReady" aria-label={`Where ${name} stands`} role="group">
      <span className="cvReadyLine">
        {!plan ? (
          <span>Reading {name}…</span>
        ) : ready ? (
          <span>
            <b>{name}</b> is ready: built, checked, published and live
          </span>
        ) : (
          <>
            <span>
              <b>{name}</b> is {plan.done} of {plan.total} steps ready
            </span>
            <button type="button" className="cvLink" data-step={plan.next.id} onClick={() => open(plan.next)} title={plan.next.label}>
              Finish
            </button>
          </>
        )}
      </span>
      {plan && (
        <span className="cvBarTrack" role="progressbar" aria-valuemin={0} aria-valuemax={plan.total} aria-valuenow={plan.done} aria-label="Steps done">
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
    </div>
  );
}
