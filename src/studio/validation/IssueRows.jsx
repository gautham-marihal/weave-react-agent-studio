import React, { useMemo } from 'react';
import Fold from '../../ui/Fold.jsx';
import { createEngine } from '../form/engine.js';
import { useSchema } from '../form/useSchema.js';
import { formatPath } from '../format.js';
import { useTechnicalNames } from '../usePref.js';
import { describeIssues } from './issues.js';
import './validation.css';

// What the checks found, for a person: each problem names the setting by its label, says what is wrong in plain words, and offers a button when the
// studio can fix it (and "Show me" to go there either way). What needs the person's own words is listed apart from what a click will fix, and the
// advice that never blocks anything last. The server's own sentence and the raw path are one click away, and open when technical names are on.
function Row({ item, config, onJump, onApply, onOpenModels }) {
  const [technical] = useTechnicalNames();
  const apply = (fix) => {
    if (fix.open) {
      onOpenModels?.(fix.open.stage);
      return;
    }
    if (!fix.apply) return;
    const next = fix.apply(config);
    if (next !== config) onApply?.(next, fix.label, fix.jumpTo);
  };
  return (
    <li className={`vxItem ${item.severity}`} data-severity={item.severity}>
      <div className="vxBody">
        {item.where.text && <small className="vxWhere">{item.where.text}</small>}
        <p>{item.text}</p>
        <div className="vxActions">
          {item.fixes.map((fix) => (
            <button type="button" key={fix.id} className="vxFix" onClick={() => apply(fix)}>
              {fix.label}
            </button>
          ))}
          {item.path && (
            <button type="button" className="stLink" onClick={() => onJump?.(item.path)}>
              Show me
            </button>
          )}
        </div>
        {item.raw !== item.text && (
          <Fold className="vxRaw" open={technical}>
            <summary>What the server said</summary>
            <p>{item.raw}</p>
            {item.path && <code>{formatPath(item.path)}</code>}
          </Fold>
        )}
      </div>
    </li>
  );
}

export default function IssueRows({ issues, config, onJump, onApply, onOpenModels }) {
  const { schema } = useSchema();
  const engine = useMemo(() => (schema ? createEngine(schema) : null), [schema]);
  const shown = useMemo(() => describeIssues(issues, { config, schema, engine }), [issues, config, schema, engine]);
  if (!issues.length) return null;
  const rowProps = { config, onJump, onApply, onOpenModels };
  return (
    <div className="vxList">
      {shown.fixNow.length > 0 && (
        <section aria-label="Can be fixed here">
          <h5>
            Fix these first <span>{shown.fixNow.length}</span>
          </h5>
          <ul>
            {shown.fixNow.map((item, i) => (
              <Row key={`f${i}`} item={item} {...rowProps} />
            ))}
          </ul>
        </section>
      )}
      {shown.needsYou.length > 0 && (
        <section aria-label="Needs your input">
          <h5>
            {shown.fixNow.length ? 'Then these, which need you' : 'Fix these first'} <span>{shown.needsYou.length}</span>
          </h5>
          <ul>
            {shown.needsYou.map((item, i) => (
              <Row key={`n${i}`} item={item} {...rowProps} />
            ))}
          </ul>
        </section>
      )}
      {shown.worthALook.length > 0 && (
        <Fold className="vxFold" open={shown.fixNow.length + shown.needsYou.length === 0}>
          <summary>
            Worth a look <span>{shown.worthALook.length}</span>
          </summary>
          <ul>
            {shown.worthALook.map((item, i) => (
              <Row key={`w${i}`} item={item} {...rowProps} />
            ))}
          </ul>
        </Fold>
      )}
    </div>
  );
}
