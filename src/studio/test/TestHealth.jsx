import React from 'react';
import { api } from '../../api/client.ts';
import { useAsync } from '../useAsync.js';
import { useGate } from '../release/gate.js';
import { isFinished, normalizeHeadline } from '../scenarios/runResults.js';
import { Switch } from '../form/fields.jsx';
import { testHealth } from './testHealth.js';

// "Ready to publish?" at the top of every part of Test: the verdict (with "Tests must pass before publishing", which holds
// publishing while they don't), and a tile per kind of test that opens its part. testHealth.js says what it all means.

// The facts for testHealth(), gathered while the Test stage is open (`on`): the newest scenario run from the server
// (read again when the part changes, so a run made on Scenarios shows when you come back), the newest readiness run, and
// the callers' latest result this visit.
//   readinessRuns: every readiness run kept in this browser, newest first; callers: the callers' summary or null
export function useTestHealth({ botId, editor, readinessRuns = [], callers = null, on = false, part = '' }) {
  const [gateOn, setGate] = useGate(botId);
  const runs = useAsync((signal) => (on ? api.listTestRuns(botId, 20, { signal }) : Promise.resolve([])), [botId, on, part]);
  const latestRun = Array.isArray(runs.data) ? runs.data.map(normalizeHeadline).find((run) => isFinished(run.status)) || null : null;
  const config = editor?.parsed?.value;
  const health = testHealth({
    scenarioCount: Array.isArray(config?.tests) ? config.tests.length : 0,
    latestRun,
    readiness: (readinessRuns || []).find((run) => run?.agentId === botId) || null,
    callers,
    gate: { enabled: gateOn },
    savedAt: editor?.meta?.savedAt || '',
    dirty: !!editor?.dirty,
  });
  return { ...health, gateOn, setGate, loading: on && runs.loading && !runs.data };
}

//   health: useTestHealth(); onOpen(part id): opens that part of Test
export default function TestHealth({ health, onOpen }) {
  const { verdict, tiles, gateOn, setGate, loading } = health;
  return (
    <section className="thStrip" aria-label="Ready to publish?">
      <div className={`thVerdict ${verdict.ok ? 'ok' : ''}`}>
        <span className="thEyebrow">Ready to publish?</span>
        <strong role="status">{loading ? 'Reading the latest run…' : verdict.title}</strong>
        {!loading && verdict.detail && <span className="thDetail">{verdict.detail}</span>}
        <span className="thGate">
          <span aria-hidden="true">{gateOn ? 'Publishing waits until the tests pass' : 'Tests must pass before publishing'}</span>
          <Switch checked={gateOn} onChange={setGate} label="Tests must pass before publishing" />
        </span>
      </div>
      {tiles.map((tile) => (
        <button key={tile.id} type="button" className="thTile" data-tile={tile.id} onClick={() => onOpen?.(tile.id)}>
          <span className="thTileHead">
            {tile.name}
            {tile.chip && <span className={`thChip ${tile.chip.tone}`}>{tile.chip.text}</span>}
          </span>
          <span className="thBig">
            {tile.big} <small>{tile.of}</small>
          </span>
          {tile.bars.length > 0 && (
            <span className="thBars" aria-hidden="true">
              {tile.bars.map((bar, i) => (
                <i key={i} className={bar} />
              ))}
            </span>
          )}
          <span className="thNote">{tile.note}</span>
        </button>
      ))}
    </section>
  );
}
