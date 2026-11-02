import React, { useState } from 'react';
import type { Path } from '../../../../types/studio';
import { CREATABLE, createAndPoint, createProblems, type Answers } from '../../../../models/schemaForm/inlineCreate';
import { Button } from '../../../ui/Button';
import { useForm } from './formContext';
import { cn, inputClass, inputErrorClass } from '../../../../utils/styles';

/**
 * "New fixed line / remembered value / HTTP connection" under a field that points at one: asks the few things
 * needed, makes it, and points the field at it, all as one change (with Undo).
 */
export function InlineCreate({ collection, target, defaultKind, onClose }: { collection: string; target: Path; defaultKind?: string; onClose: () => void }) {
  const ctx = useForm();
  const spec = CREATABLE[collection];
  const [answers, setAnswers] = useState<Answers>({ kind: defaultKind || 'string' });
  const [tried, setTried] = useState(false);
  if (!spec) return null;
  const problems = createProblems(collection, answers, ctx.config);
  const set = (key: string, value: string) => setAnswers((old) => ({ ...old, [key]: value }));
  const submit = () => {
    setTried(true);
    if (Object.keys(problems).length) return;
    const { config: made, id } = createAndPoint(ctx.config, collection, answers, target);
    ctx.applyConfig(made, `Made ${spec.word} “${id}” and chose it here.`);
    onClose();
  };
  return (
    <div role="group" aria-label={`New ${spec.word}`} className="mt-2 space-y-3 rounded-lg border border-accent/30 bg-accent-soft/30 p-3">
      <p className="text-[13px] font-semibold text-ink">New {spec.word}</p>
      {spec.ask.map((field, i) => {
        const id = `inline-${collection}-${field.key}`;
        const bad = tried && problems[field.key];
        return (
          <div key={field.key}>
            <label htmlFor={id} className="text-[13px] font-medium text-ink">
              {field.label}
            </label>
            {field.options ? (
              <select id={id} className={cn(inputClass, 'mt-1')} value={answers[field.key] ?? ''} onChange={(e) => set(field.key, e.target.value)}>
                {field.options.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            ) : field.multiline ? (
              <textarea id={id} rows={3} className={cn(inputClass, 'mt-1', bad && inputErrorClass)} value={answers[field.key] ?? ''} onChange={(e) => set(field.key, e.target.value)} autoFocus={i === 0} />
            ) : (
              <input
                id={id}
                type="text"
                className={cn(inputClass, 'mt-1', bad && inputErrorClass)}
                spellCheck={false}
                value={answers[field.key] ?? ''}
                placeholder={field.hint}
                autoFocus={i === 0}
                onChange={(e) => set(field.key, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
            )}
            {bad && <p className="mt-1 text-[13px] text-danger">{problems[field.key]}</p>}
          </div>
        );
      })}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={submit}>
          Make it and use it
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
