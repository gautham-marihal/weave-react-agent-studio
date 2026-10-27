import React, { Suspense, lazy, useMemo } from 'react';
import { groupIssues } from '../api/client.ts';
import { formatPath } from './format.js';
import { splitUnsupported } from './preflight.ts';
import { Spinner } from './ui.jsx';
import Icon from '../ui/Icon.jsx';

// The problem list is loaded when it is first shown.
const IssueRows = lazy(() => import('./validation/IssueRows.jsx'));

// What the checks found: a verdict, parts declared but not enforced, the problems (each linked to its place), what the
// runtime can't run yet, and the secrets the agent needs.
export function ValidationPanel({ editor, onJump, onJumpOffset, folded = false, onFold, onApply, onOpenModels }) {
  const { report, validating, parsed } = editor;
  const issues = useMemo(() => groupIssues(report), [report]);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const { security, advice } = splitUnsupported(report?.unsupported);

  let headline;
  if (parsed.duplicates?.length) headline = { tone: 'bad', text: 'A key is repeated' };
  else if (parsed.error) headline = { tone: 'bad', text: 'Not valid JSON' };
  else if (!editor.isObject) headline = { tone: 'bad', text: 'The config must be a JSON object' };
  else if (!report) headline = { tone: 'idle', text: 'Checking…' };
  else if (report.valid && advice.length)
    headline = { tone: 'warn', text: `Valid, with ${advice.length} part${advice.length === 1 ? '' : 's'} that will not run` };
  else if (report.valid) headline = { tone: 'good', text: 'Valid. Ready to publish' };
  else headline = { tone: 'bad', text: `${errors.length} error${errors.length === 1 ? '' : 's'} to fix before publishing` };

  // The folded line also counts these, so a hidden panel never hides that parts won't run or a key is missing.
  const secretCount = (report?.secrets_required || []).length;
  const summaryLine =
    parsed.error || !report
      ? ''
      : [
          security.length ? `${security.length} not enforced` : '',
          report.valid && advice.length ? '' : advice.length ? `${advice.length} not available yet` : '',
          warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : '',
          secretCount ? `${secretCount} secret${secretCount === 1 ? '' : 's'} needed` : '',
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <aside className={`stValidation ${folded ? 'folded' : ''}`} aria-label="Validation">
      <div className={`stValidationHead ${headline.tone}`}>
        <i aria-hidden="true" />
        <div>
          <strong>{headline.text}</strong>
          {folded && summaryLine && <small className="stValidationSummary">{summaryLine}</small>}
          {!folded && (
            <small>
              {validating
                ? 'Checking your latest edit…'
                : warnings.length
                  ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}, which never block publishing`
                  : 'Saving is always allowed, even with errors.'}
            </small>
          )}
        </div>
        {onFold && (
          <button type="button" className="stFoldBtn" aria-expanded={!folded} aria-label={folded ? 'Show the checks' : 'Hide the checks'} onClick={onFold}>
            <Icon name={folded ? 'chevronRight' : 'chevronDown'} size={14} />
          </button>
        )}
      </div>

      {security.length > 0 && !parsed.error && (
        <div className="stSecurity" role="alert">
          <strong>
            {security.length} protection{security.length === 1 ? ' is' : 's are'} declared but not enforced
          </strong>
          <p>
            The agent looks protected and is not: the runtime doesn’t enforce {security.length === 1 ? 'this' : 'these'} yet. Don’t rely on{' '}
            {security.length === 1 ? 'it' : 'them'}, and think twice before deploying to production.
          </p>
          <ul>
            {security.map((item, index) => (
              <li key={index}>
                {item.feature} <code>{item.where}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!folded && (
        <>
          {parsed.error && <p className="stParseError">{parsed.error}</p>}
          {parsed.duplicates?.length > 0 && (
            <ul className="stIssues">
              {parsed.duplicates.map((item, index) => (
                <li key={index} className="error">
                  <button type="button" onClick={() => onJumpOffset?.(item.offset)} title="Show the repeat">
                    <b aria-hidden="true">!</b>
                    <span>
                      <code>{formatPath([...item.path, item.key])}</code>
                      <em>Repeated key “{item.key}”. This one would win; the first would be lost.</em>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!parsed.error && (errors.length > 0 || warnings.length > 0) && (
            <Suspense fallback={<Spinner label="Reading the checks" />}>
              <IssueRows issues={[...errors, ...warnings]} config={editor.parsed.value} onJump={onJump} onApply={onApply} onOpenModels={onOpenModels} />
            </Suspense>
          )}

          {advice.length > 0 && (
            <details className="stFold amber">
              <summary>Not available yet ({advice.length})</summary>
              <p className="stFoldNote">The runtime can’t run these parts of this agent yet. They are saved but will have no effect.</p>
              <ul className="stPlain">
                {advice.map((item, index) => (
                  <li key={index}>
                    {item.feature} <code>{item.where}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {report?.secrets_required?.length > 0 && (
            <details className="stFold">
              <summary>Secrets this agent needs ({report.secrets_required.length})</summary>
              <p className="stFoldNote">Names only. Values live in the server’s environment and cannot be set from here yet.</p>
              <div className="stChips">
                {report.secrets_required.map((name) => (
                  <code key={name}>{name}</code>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </aside>
  );
}
