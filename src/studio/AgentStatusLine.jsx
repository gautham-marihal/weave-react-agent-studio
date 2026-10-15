import React, { useMemo } from 'react';
import { api } from '../api/client.js';
import { formatRelative } from '../pages/helpers.js';
import { normalizeHeadline, isFinished } from './scenarios/runResults.js';
import StatePill from './StatePill.jsx';
import { agentState, statusLine } from './status.js';
import { useAsync } from './useAsync.js';

// The name of an agent and what is known about it, in three quiet rows: the name with its one state, the description, and a single line of facts (its id,
// what is saved, how its tests stand, how many calls it had today). Each fact is read from the API (the test runs and the calls) or from the agent
// itself; a fact that can't be read is left out, never guessed. Where it is live is said by the state pill and by the environment slots beside this block,
// so the line only says it when the agent is not live anywhere.
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

export default function AgentStatusLine({ botId, name, description, summary, editor, refreshKey = 0, newerPublished = '' }) {
  const runs = useAsync((signal) => api.listTestRuns(botId, 5, { signal }), [botId, refreshKey]);
  const calls = useAsync((signal) => api.listCalls(botId, { since: startOfToday(), limit: 50 }, { signal }), [botId, refreshKey]);
  const scenarioCount = Array.isArray(editor.parsed.value?.tests) ? editor.parsed.value.tests.length : 0;
  const latest = useMemo(() => {
    const items = Array.isArray(runs.data) ? runs.data : Array.isArray(runs.data?.runs) ? runs.data.runs : [];
    return items.map(normalizeHeadline).find((run) => isFinished(run.status)) || null;
  }, [runs.data]);
  const callsToday = calls.data && Array.isArray(calls.data.calls) ? calls.data.calls.length : null;
  const deployed = summary?.deployed || {};
  const live = Object.values(deployed).some(Boolean);
  const parts = statusLine({
    dirty: editor.dirty, savedAt: editor.meta?.savedAt ? formatRelative(editor.meta.savedAt).toLowerCase() : '', scenarioCount, run: latest, deployed, callsToday,
  // unsaved edits are flagged by the "Unsaved" marker beside Publish, and where it is live is shown beside the name
  }).filter((part) => !(part.id === 'live' && live) && !(part.id === 'draft' && editor.dirty));
  // 50 is all that was asked for: past it the count is "at least"
  if (callsToday === 50 && calls.data?.next) { const i = parts.findIndex((p) => p.id === 'calls'); if (i >= 0) parts[i] = { ...parts[i], text: '50+ calls today' }; }
  const problems = Array.isArray(editor.report?.errors) ? editor.report.errors.length : 0;
  const state = agentState({ deployed, tests: latest ? (latest.status === 'passed' ? 'passed' : latest.status === 'skipped' ? 'unknown' : 'failed') : 'unknown', problems });
  return (
    <div className="stHeaderCopy">
      <div className="stTitleRow">
        <h1>{name}</h1>
        <StatePill state={state} />
      </div>
      {description && <p className="stHeaderDesc" title={description}>{description}</p>}
      <ul className="stStatusLine" aria-label="Where this agent stands">
        <li className="stStatusId"><code>{botId}</code></li>
        {parts.map((part) => <li key={part.id} className={part.tone} data-part={part.id}>{part.text}</li>)}
        {newerPublished && <li className="idle" data-part="newer" title="Published, but not deployed there yet">newer v{newerPublished} published</li>}
      </ul>
    </div>
  );
}
