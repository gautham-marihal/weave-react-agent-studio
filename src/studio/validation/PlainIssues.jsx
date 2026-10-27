import React, { useMemo } from 'react';
import { createEngine } from '../form/engine.js';
import { useSchema } from '../form/useSchema.js';
import { describeIssue } from './issues.js';
import './validation.css';

// A plain list of problems where fixes can't be offered (a dialog, the notice after a failed publish), named by labels,
// never paths. `issues`: `{ path, message, severity }` as the server sends them (severity defaults to the given one).
export default function PlainIssues({ issues = [], config = null, severity = 'warning' }) {
  const { schema } = useSchema();
  const engine = useMemo(() => (schema ? createEngine(schema) : null), [schema]);
  const shown = useMemo(
    () => issues.map((issue) => describeIssue({ severity, ...issue }, { config, schema, engine })),
    [issues, config, schema, engine, severity],
  );
  return (
    <ul className="stPlain vxPlain">
      {shown.map((item, i) => (
        <li key={i}>
          {item.where.text && <small className="vxWhere">{item.where.text}</small>}
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}
