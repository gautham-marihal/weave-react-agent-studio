import React, { useEffect, useMemo, useState } from 'react';
import { JsonInput, StringList } from './fields.jsx';
import { PARAM_KINDS, modelView, problems as paramProblems, readParams, writeParams } from './paramSchema.js';
import Icon from '../../ui/Icon.jsx';
import Select from '../../ui/Select.tsx';

// A tool's parameters as rows (name, kind, purpose, needed, choices) instead of
// hand-written JSON Schema. What the rows can't show is written back untouched; "Edit
// as JSON" shows it all. Rows live in local state so a half-typed name doesn't vanish.
export default function ParamsEditor({ value, onChange, toolName, description, disabled }) {
  const parsed = useMemo(() => readParams(value), [value]);
  const [rows, setRows] = useState(parsed.rows);
  const [json, setJson] = useState(false);
  const canonical = (list) => JSON.stringify(writeParams(list, parsed.rest));
  // follow the config when it changes from outside (undo, the JSON view, a restored version)
  useEffect(() => {
    if (canonical(rows) !== JSON.stringify(writeParams(parsed.rows, parsed.rest))) setRows(parsed.rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (next) => {
    setRows(next);
    onChange(writeParams(next, parsed.rest));
  };
  const setRow = (index, patch) => update(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const found = paramProblems(rows);
  const view = modelView({ name: toolName, description, rows });

  if (!parsed.canEdit || json) {
    return (
      <div className="stParams">
        {parsed.canEdit && (
          <button type="button" className="stLink" onClick={() => setJson(false)}>
            Back to the parameter list
          </button>
        )}
        {!parsed.canEdit && <p className="stFWarn">These parameters aren’t a plain list of values, so they are edited as JSON Schema.</p>}
        <JsonInput value={value} onChange={onChange} disabled={disabled} />
      </div>
    );
  }

  return (
    <div className="stParams">
      {rows.length === 0 && <p className="stFEmpty">No parameters. The model calls this tool with nothing to fill in.</p>}
      {rows.map((row, index) => (
        <div className="stParamRow" key={index} data-param={row.name}>
          <div className="stParamTop">
            <input
              className="stFInput mono"
              type="text"
              spellCheck={false}
              value={row.name}
              placeholder="parameter_name"
              aria-label={`Parameter ${index + 1} name`}
              disabled={disabled}
              onChange={(event) => setRow(index, { name: event.target.value })}
            />
            {row.kind === 'advanced' ? (
              <span className="stFTag">structured</span>
            ) : (
              <Select
                className="stFInput small"
                value={row.kind}
                aria-label={`Parameter ${index + 1} kind`}
                disabled={disabled}
                onChange={(event) =>
                  setRow(index, { kind: event.target.value, choices: event.target.value === 'choice' && !row.choices.length ? ['', ''] : row.choices })
                }
              >
                {PARAM_KINDS.map((kind) => (
                  <option key={kind.id} value={kind.id}>
                    {kind.label}
                  </option>
                ))}
              </Select>
            )}
            <label className="stParamReq">
              <input type="checkbox" checked={row.required} disabled={disabled} onChange={(event) => setRow(index, { required: event.target.checked })} />{' '}
              required
            </label>
            <button
              type="button"
              className="stFDel small"
              aria-label={`Delete parameter ${row.name || index + 1}`}
              disabled={disabled}
              onClick={() => {
                onChange(
                  writeParams(
                    rows.filter((_, i) => i !== index),
                    parsed.rest,
                  ),
                  { deleted: `parameter ${row.name || index + 1}` },
                );
                setRows(rows.filter((_, i) => i !== index));
              }}
            >
              Delete
            </button>
          </div>
          {row.kind === 'advanced' ? (
            <small className="stMuted">This parameter has a structure the list can’t show. Use “Edit as JSON” to change it.</small>
          ) : (
            <input
              className="stFInput"
              type="text"
              value={row.description}
              placeholder="What it is for: the model reads this to decide what to fill in"
              aria-label={`Parameter ${index + 1} description`}
              disabled={disabled}
              onChange={(event) => setRow(index, { description: event.target.value })}
            />
          )}
          {row.kind === 'choice' && (
            <div className="stParamChoices">
              <span className="stMuted">Allowed values</span>
              <StringList
                values={row.choices}
                onChange={(next) => setRow(index, { choices: next })}
                disabled={disabled}
                placeholder="a value the model may pick"
                addLabel="Add a value"
              />
            </div>
          )}
        </div>
      ))}
      {found
        .filter((item) => !item.level)
        .map((item, i) => (
          <small key={i} className="stFErr">
            {item.text}
          </small>
        ))}
      {found
        .filter((item) => item.level === 'hint')
        .slice(0, 2)
        .map((item, i) => (
          <small key={`h${i}`} className="stFHint">
            {item.text}
          </small>
        ))}
      <div className="stParamActions">
        <button
          type="button"
          className="stAddBtn"
          disabled={disabled}
          onClick={() => update([...rows, { name: '', kind: 'string', description: '', choices: [], required: false, extra: {} }])}
        >
          <Icon name="plus" size={14} /> Add a parameter
        </button>
        <button type="button" className="stLink" onClick={() => setJson(true)}>
          Edit as JSON
        </button>
      </div>
      <div className="stModelView" aria-label="What the model sees">
        <strong>What the model sees</strong>
        <code>{view.signature}</code>
        {view.description && <p>{view.description}</p>}
        {view.params.length > 0 ? (
          <ul>
            {view.params.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="stMuted">No parameters.</p>
        )}
        <small className="stMuted">
          In this tool’s fields, write a parameter as <code>{'{{args.NAME}}'}</code>.
        </small>
      </div>
    </div>
  );
}
