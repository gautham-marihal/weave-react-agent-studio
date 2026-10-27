import React, { useMemo } from 'react';
import Icon from '../../../ui/Icon.jsx';
import { groupIssues } from '../../../api/client.ts';
import { isDemoMode } from '../../../demo/demoMode.js';
import { describeIssue } from '../../validation/issues.js';

// The checks card beside Build's pages: up to date or checking, the problems (each opens its place) and the secrets the
// server needs, by name. "See all" opens the full panel with every warning and fix.
//   onJump(path): opens the place of a problem; onAll: opens the full panel
const SHOWN = 3;

export default function ChecksCard({ editor, onJump, onAll }) {
  const { report, validating, parsed } = editor;
  const issues = useMemo(() => groupIssues(report), [report]);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.length - errors.length;
  const secrets = report?.secrets_required || [];
  const broken = !!parsed.error || !editor.isObject;

  return (
    <section aria-labelledby="checksCardTitle" className="tw-overflow-hidden tw-rounded-card tw-border tw-border-solid tw-border-line tw-bg-surface">
      <header className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-border-0 tw-border-b tw-border-solid tw-border-line tw-px-5 tw-py-4">
        <h2 id="checksCardTitle" className="tw-m-0 tw-text-md tw-font-semibold tw-text-ink">
          Checks
        </h2>
        <span className="tw-text-sm tw-text-muted">{validating || (!report && !broken) ? 'Checking…' : 'Up to date'}</span>
      </header>

      <div className="tw-grid tw-gap-5 tw-px-5 tw-py-4">
        {broken ? (
          <Verdict tone="bad" icon="alert" text="The draft isn’t valid JSON, so it can’t be checked. Open the JSON to fix it." />
        ) : !report ? (
          <Verdict tone="idle" icon="clock" text="Checking the draft…" />
        ) : errors.length ? (
          <div className="tw-grid tw-gap-3">
            <Verdict tone="bad" icon="alert" text={`${errors.length} ${errors.length === 1 ? 'problem' : 'problems'} to fix before it can be published.`} />
            <ul className="tw-m-0 tw-grid tw-list-none tw-gap-1 tw-p-0">
              {errors.slice(0, SHOWN).map((issue, index) => (
                <li key={`${issue.path}|${index}`}>
                  <button
                    type="button"
                    className="tw-w-full tw-cursor-pointer tw-rounded-control tw-border-0 tw-bg-transparent tw-px-2 tw-py-1.5 tw-text-left tw-text-sm tw-text-ink-soft hover:tw-bg-subtle disabled:tw-cursor-default disabled:hover:tw-bg-transparent"
                    disabled={!issue.path}
                    onClick={() => onJump(issue.path)}
                  >
                    {describeIssue(issue, { config: parsed.value }).text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Verdict tone="good" icon="check" text="No problems. This draft can be tested and published." />
        )}

        {(errors.length > SHOWN || warnings > 0) && (
          <button type="button" className="linkButton tw-justify-self-start tw-text-sm" onClick={onAll}>
            See all{warnings > 0 ? `, with ${warnings} ${warnings === 1 ? 'note' : 'notes'} worth a look` : ''}
          </button>
        )}

        {secrets.length > 0 && (
          <div className="tw-grid tw-gap-1.5">
            <h3 className="tw-m-0 tw-text-sm tw-font-semibold tw-text-ink">Secrets the server needs</h3>
            <p className="tw-m-0 tw-text-sm tw-text-muted">Names only. Admins set the values on the server; the studio never sees them.</p>
            <ul className="tw-m-0 tw-grid tw-list-none tw-gap-1 tw-p-0">
              {secrets.map((name) => (
                <li key={name} className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-text-ink-soft">
                  <Icon name="key" size={14} />
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isDemoMode() && <p className="tw-m-0 tw-text-sm tw-text-muted">Demo mode: checked by simple rules in this browser, not by the server.</p>}
      </div>
    </section>
  );
}

// The verdict in one line, with its icon
function Verdict({ tone, icon, text }) {
  const colour = { good: 'tw-text-success', bad: 'tw-text-danger', idle: 'tw-text-muted' }[tone];
  return (
    <p className="tw-m-0 tw-flex tw-items-start tw-gap-2.5 tw-text-md tw-leading-relaxed tw-text-ink">
      <span className={`tw-mt-[3px] tw-flex ${colour}`}>
        <Icon name={icon} size={16} />
      </span>
      {text}
    </p>
  );
}
