import React, { useMemo } from 'react';
import { api } from '../../api/client.ts';
import { navigate, routeHref } from '../route.js';
import { useAsync } from '../useAsync.js';
import { useProviders } from '../models/useProviders.js';
import { normalizeKnowledge } from '../knowledge/model.js';
import { normalizeHeadline } from '../scenarios/runResults.js';
import { POLICY_NOTE, buildChecklist, verdict } from './checklist.js';
import './release.css';
import Icon from '../../ui/Icon.jsx';
import Button from '../../ui/Button.tsx';

// "Is it safe to put this live?" for a published version (Deploy tab) or the draft (Publish dialog).
// Each line shows only when it applies; it informs and can't enforce (see checklist.js).
const MARK = { ok: 'check', warn: 'alert', bad: 'close', info: 'info' };

export default function ReleaseChecklist({ botId, config, report, version, environment, target = 'version', refreshKey = 0, compact = false }) {
  const hasKnowledge = Array.isArray(config?.knowledge) && config.knowledge.length > 0;
  const hasTests = Array.isArray(config?.tests) && config.tests.length > 0;
  const ref = target === 'version' ? version?.version : 'draft';
  const runs = useAsync((signal) => (hasTests ? api.listTestRuns(botId, 30, { signal }) : Promise.resolve([])), [botId, hasTests, refreshKey]);
  const knowledge = useAsync(
    (signal) => (hasKnowledge && ref ? api.getKnowledge(botId, { ref }, { signal }) : Promise.resolve(null)),
    [botId, hasKnowledge, ref, refreshKey],
  );
  const { providers } = useProviders();
  const headlines = useMemo(() => (Array.isArray(runs.data) ? runs.data.map(normalizeHeadline) : []), [runs.data]);
  const normalizedKnowledge = useMemo(() => (knowledge.data ? normalizeKnowledge(knowledge.data) : null), [knowledge.data]);
  const items = useMemo(
    () => buildChecklist({ config, report, version, runs: headlines, knowledge: normalizedKnowledge, providers, environment, target }),
    [config, report, version, headlines, normalizedKnowledge, providers, environment, target],
  );
  const loading = (hasTests && runs.loading && !runs.data) || (hasKnowledge && knowledge.loading && !knowledge.data);
  const summary = verdict(items);
  const failedToRead = [runs.error && 'the test runs', knowledge.error && 'the knowledge'].filter(Boolean);

  return (
    <section className={`rcList ${compact ? 'compact' : ''}`} aria-label="Release checklist" data-verdict={summary.state}>
      <header className="rcHead">
        <h4>Is it safe to put this live?</h4>
        {!loading && (
          <span className={`rcVerdict ${summary.state}`} role="status">
            {summary.text}
          </span>
        )}
      </header>
      {loading && (
        <p className="stMuted" role="status">
          Checking…
        </p>
      )}
      <ul>
        {items.map((item) => (
          <li key={item.id} className={`rcItem ${item.state}`} data-check={item.id}>
            <span className="rcMark" aria-hidden="true">
              <Icon name={MARK[item.state] || 'info'} size={14} />
            </span>
            <div className="rcBody">
              <p>
                <strong>{item.label}:</strong> {item.text}
              </p>
              {item.note && <p className="rcNote">{item.note}</p>}
              {item.detail?.length > 0 && (
                <ul className="rcDetail">
                  {item.detail.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
            {item.action && (
              <Button type="button" onClick={() => navigate(routeHref(botId, item.action.tab, item.action.params), { guard: false })}>
                {item.action.label}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {failedToRead.length > 0 && (
        <p className="stFWarn" role="note">
          Couldn’t read {failedToRead.join(' or ')}, so those lines are missing. This doesn’t mean they pass.
        </p>
      )}
      {!compact && <p className="rcPolicy">{POLICY_NOTE}</p>}
    </section>
  );
}
