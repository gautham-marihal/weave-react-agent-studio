import React, { useState } from 'react';
import { useConfigSelect, useForm } from './ctx.js';
import { CREATABLE, createAndPoint, createProblems } from './inlineCreate.js';
import Select from '../../ui/Select.tsx';
import Button from '../../ui/Button.tsx';
import { Input, TextArea } from '../../ui/Input.tsx';

// "＋ New message / state variable / HTTP connection" under a field that points at one: asks the few things needed,
// makes it, and points the field at it, all as one change (with Undo).
export default function InlineCreate({ collection, target, defaultKind, onClose }) {
  const ctx = useForm();
  const spec = CREATABLE[collection];
  const config = useConfigSelect((c) => c, Object.is); // small, and only here while something is being created
  const [answers, setAnswers] = useState({ kind: defaultKind || 'string' });
  const [tried, setTried] = useState(false);
  if (!spec) return null;
  const problems = createProblems(collection, answers, config);
  const set = (key, value) => setAnswers((old) => ({ ...old, [key]: value }));
  const submit = () => {
    setTried(true);
    if (Object.keys(problems).length) return;
    const { config: made, id } = createAndPoint(ctx.store.get(), collection, answers, target);
    ctx.applyConfig(made, `Created ${spec.word} “${id}”${target ? ' and pointed this field at it' : ''}.`);
    onClose();
  };
  return (
    <div className="stInlineCreate" role="group" aria-label={`New ${spec.word}`}>
      <strong>New {spec.word}</strong>
      {spec.ask.map((field) => (
        <label key={field.key} className="stICField">
          <span>{field.label}</span>
          {field.options ? (
            <Select className="stFInput small" value={answers[field.key] ?? ''} onChange={(event) => set(field.key, event.target.value)}>
              {field.options.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          ) : field.multiline ? (
            <TextArea rows={3} value={answers[field.key] ?? ''} onChange={(event) => set(field.key, event.target.value)} autoFocus />
          ) : (
            <Input
              size="small"
              type="text"
              spellCheck={false}
              value={answers[field.key] ?? ''}
              placeholder={field.hint}
              onChange={(event) => set(field.key, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
              autoFocus={field === spec.ask[0]}
            />
          )}
          {tried && problems[field.key] && <small className="stFErr">{problems[field.key]}</small>}
        </label>
      ))}
      <div className="stICActions">
        <button type="button" className="stAddBtn" onClick={submit}>
          Create{target ? ' and use' : ''}
        </button>
        <Button type="button" size="small" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
