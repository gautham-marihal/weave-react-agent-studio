import React, { useMemo } from 'react';
import { createEngine } from '../form/engine.js';
import { useSchema } from '../form/useSchema.js';
import { describeIssue } from './issues.js';
import './validation.css';

// A plain list of problems for a place that can't offer fixes (a dialog, the notice after a failed publish): each one named by its labels and said in
// plain words, never by its path. `issues` are `{ path, message, severity }` as the server sends them (severity defaults to the given one).
export default function PlainIssues({ issues = [], config = null, severity = 'warning', limit = 0 }) {
  const { schema } = useSchema();
  const engine = useMemo(() => (schema ? createEngine(schema) : null), [schema]);
  const shown = useMemo(
    () => (limit ? issues.slice(0, limit) : issues).map((issue) => describeIssue({ severity, ...issue }, { config, schema, engine })),
    [issues, config, schema, engine, severity, limit],
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
