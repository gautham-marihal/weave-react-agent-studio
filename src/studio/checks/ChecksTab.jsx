import React, { useMemo, useState } from 'react';
import { api } from '../../api/client.ts';
import { SCENARIOS, runScenarioChecks } from '../scenarios.js';
import { formatWhen, randomTag } from '../format.js';
import { Notice } from '../ui.jsx';
import { useAsync } from '../useAsync.js';
import Select from '../../ui/Select.tsx';
import './checks.css';
import Icon from '../../ui/Icon.jsx';
import { EmptyState } from '../agent/PageShell.jsx';

// "Checks": the agent's config read against everyday situations (a greeting, ending the call, reaching a person, a
// silent caller) before going live; no conversation is run. Runs are kept in this browser: the API has no store.
const makeId = () => `SIM_${Date.now().toString(36)}${randomTag()}`;

export default function ChecksTab({ botId, name, runs = [], onRun }) {
  const versions = useAsync((signal) => api.listVersions(botId, { signal }), [botId]);
  const options = useMemo(
    () => [
      { key: 'draft', label: 'The saved draft' },
      ...(Array.isArray(versions.data) ? versions.data : []).map((v, i) => ({ key: v.version, label: `Version ${v.version}${i === 0 ? ' (latest)' : ''}` })),
    ],
    [versions.data],
  );
  const [picked, setPicked] = useState('draft');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const mine = runs.filter((run) => run.agentId === botId);

  const run = async () => {
    if (running) return;
    const option = options.find((o) => o.key === picked) || options[0];
    setRunning(true);
    setError('');
    try {
      const config = option.key === 'draft' ? (await api.getDraft(botId)).config : (await api.getVersion(botId, option.key)).config;
      const results = runScenarioChecks(config);
      const record = {
        id: makeId(),
        agentId: botId,
        agentName: name,
        versionKey: option.key,
        versionLabel: option.label.replace(' (latest)', ''),
        ranAt: new Date().toISOString(),
        total: results.length,
        passed: results.filter((r) => r.passed).length,
        results,
      };
      onRun?.(record);
      setOpen(record.id);
    } catch (e) {
      setError(`Couldn’t read that configuration: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="ckTab">
      <section className="stCard ckIntro">
        <h3>
          Readiness checks <span className="ckBeta">Beta</span>
        </h3>
        <p>
          Look at {name || 'this agent'}’s configuration against everyday situations before you put it live: a greeting, a way to end the call, reaching a
          person, a caller who goes quiet. These checks only read what is configured. No conversation is run and no call is placed. To really talk to the agent,
          use <strong>Test</strong>; to run the conversations it must always get right, use <strong>Scenarios</strong>.
        </p>
        <div className="ckRunner">
          <label>
            <span>Check</span>
            <Select className="stFInput small" value={picked} onChange={(event) => setPicked(event.target.value)} aria-label="Which version to check">
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>
          <button type="button" className="primaryCta compactCta" onClick={run} disabled={running}>
            {running ? 'Checking…' : `Run ${SCENARIOS.length} checks`}
          </button>
        </div>
        {error && (
          <Notice kind="error" title="Couldn’t run the checks">
            {error}
          </Notice>
        )}
      </section>

      {mine.length === 0 ? (
        <EmptyState
          icon="check"
          title="No checks run yet"
          text={`Run the ${SCENARIOS.length} checks above to see how ${name || 'this agent'} handles everyday situations. Every run is kept here to compare.`}
        />
      ) : (
        <ul className="ckRuns" aria-label="Earlier checks">
          {mine.map((item) => {
            const isOpen = open === item.id;
            const all = item.passed === item.total;
            return (
              <li key={item.id} className={isOpen ? 'open' : ''}>
                <button type="button" className="ckRunHead" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : item.id)}>
                  <span className={`ckChip ${all ? 'pass' : 'warn'}`}>
                    <Icon name={all ? 'check' : 'alert'} size={13} /> Passed {item.passed} of {item.total}
                  </span>
                  <strong>{item.versionLabel}</strong>
                  <time>{formatWhen(item.ranAt)}</time>
                </button>
                {isOpen && (
                  <ul className="ckResults">
                    {item.results.map((result) => (
                      <li key={result.id} className={result.passed ? 'pass' : 'fail'}>
                        <b aria-hidden="true">
                          <Icon name={result.passed ? 'check' : 'close'} size={14} />
                        </b>
                        <span>
                          <strong>{result.name}</strong>
                          <small>{result.detail}</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
