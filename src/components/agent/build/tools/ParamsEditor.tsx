import React, { useEffect, useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { PARAM_KINDS, modelView, newParamRow, paramProblems, readParams, writeParams, type ParamKind, type ParamRow } from '../../../../models/toolsParams';
import { Button } from '../../../ui/Button';
import { cn, inputClass } from '../../../../utils/styles';
import { Note } from './parts';
import { linkButton } from './keys';

interface ParamsEditorProps {
  value: unknown;
  onChange: (schema: Record<string, unknown>) => void;
  toolName: string;
  description?: string;
  disabled?: boolean;
}

/**
 * A tool's parameters as rows (name, kind, what it is for, required, choices) instead of hand-written JSON Schema. What
 * the rows can't show is written back untouched; "Edit as JSON" shows it all. Rows live here so a half-typed name
 * doesn't vanish; the config follows each change.
 */
export function ParamsEditor({ value, onChange, toolName, description, disabled }: ParamsEditorProps) {
  const parsed = readParams(value);
  const [rows, setRows] = useState<ParamRow[]>(parsed.rows);
  const [json, setJson] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(value ?? { type: 'object', properties: {} }, null, 2));
  const [jsonError, setJsonError] = useState('');

  // Follow the config when it changes from elsewhere (undo, the JSON view).
  const outside = JSON.stringify(value ?? null);
  useEffect(() => {
    if (JSON.stringify(writeParams(rows, parsed.rest)) !== JSON.stringify(writeParams(parsed.rows, parsed.rest))) setRows(parsed.rows);
    if (!json) setJsonText(JSON.stringify(value ?? { type: 'object', properties: {} }, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outside]);

  const write = (next: ParamRow[]) => {
    setRows(next);
    onChange(writeParams(next, parsed.rest));
  };
  const setRow = (index: number, patch: Partial<ParamRow>) => write(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const found = paramProblems(rows);
  const view = modelView({ name: toolName, description, rows });

  if (!parsed.canEdit || json) {
    return (
      <div className="space-y-2">
        {!parsed.canEdit && <Note tone="warn">These parameters aren’t a plain list of values, so they are edited as JSON Schema.</Note>}
        <textarea
          aria-label="Parameters as JSON Schema"
          rows={8}
          spellCheck={false}
          className={cn(inputClass, 'resize-y font-mono text-[13px]')}
          value={jsonText}
          disabled={disabled}
          onChange={(e) => {
            setJsonText(e.target.value);
            try {
              const next: unknown = JSON.parse(e.target.value);
              if (typeof next !== 'object' || next === null || Array.isArray(next)) throw new Error('It must be a JSON object.');
              setJsonError('');
              onChange(next as Record<string, unknown>);
            } catch (err: unknown) {
              setJsonError(err instanceof Error ? err.message : String(err));
            }
          }} />
        {jsonError && <Note tone="error" role="alert">Not valid JSON: {jsonError}</Note>}
        {parsed.canEdit &&
        <button type="button" className={cn(linkButton, 'text-[13px]')} onClick={() => setJson(false)}>
            Back to the parameter list
          </button>
        }
      </div>);

  }

  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="text-[13px] text-muted">No parameters. The model calls this tool with nothing to fill in.</p>}
      {rows.length > 0 &&
      <ul className="space-y-2" aria-label="Parameters">
          {rows.map((row, index) =>
        <li key={index} data-param={row.name} className="rounded-md border border-line bg-canvas/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
              className={cn(inputClass, 'w-48 font-mono text-[13px]')}
              value={row.name}
              placeholder="parameter_name"
              spellCheck={false}
              aria-label={`Parameter ${index + 1} name`}
              disabled={disabled}
              onChange={(e) => setRow(index, { name: e.target.value })} />
                {row.kind === 'advanced' ?
            <span className="rounded bg-subtle px-2 py-1 text-xs text-muted">structured</span> :

            <select
              className={cn(inputClass, 'w-40')}
              value={row.kind}
              aria-label={`Parameter ${index + 1} kind`}
              disabled={disabled}
              onChange={(e) => {
                const kind = e.target.value as ParamKind;
                setRow(index, { kind, choices: kind === 'choice' && !row.choices.length ? [''] : row.choices });
              }}>
                    {PARAM_KINDS.map((k) =>
              <option key={k.id} value={k.id}>{k.label}</option>
              )}
                  </select>
            }
                <label className="flex items-center gap-1.5 text-[13px] text-ink-soft">
                  <input type="checkbox" checked={row.required} disabled={disabled} onChange={(e) => setRow(index, { required: e.target.checked })} />
                  Required
                </label>
                {!disabled &&
            <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Delete parameter ${row.name || index + 1}`} onClick={() => write(rows.filter((_, i) => i !== index))}>
                    <Trash2Icon className="h-3.5 w-3.5" aria-hidden />
                  </Button>
            }
              </div>
              {row.kind === 'advanced' ?
          <p className="mt-2 text-xs text-muted">This parameter has a structure the list can’t show. Use “Edit as JSON” to change it.</p> :

          <input
            className={cn(inputClass, 'mt-2')}
            value={row.description}
            placeholder="What it is for: the model reads this to decide what to fill in"
            aria-label={`Parameter ${index + 1} description`}
            disabled={disabled}
            onChange={(e) => setRow(index, { description: e.target.value })} />

          }
              {row.kind === 'choice' &&
          <label className="mt-2 block">
                  <span className="text-xs text-muted">Allowed values, one per line</span>
                  <textarea
              rows={Math.max(2, row.choices.length)}
              className={cn(inputClass, 'mt-1 resize-y')}
              value={row.choices.join('\n')}
              disabled={disabled}
              aria-label={`Allowed values of ${row.name || `parameter ${index + 1}`}`}
              onChange={(e) => setRow(index, { choices: e.target.value.split('\n') })} />
                </label>
          }
              {found.filter((f) => f.index === index).slice(0, 2).map((f) =>
          <p key={f.text} className={cn('mt-1.5 text-xs', f.level ? 'text-muted' : 'text-danger')}>{f.text}</p>
          )}
            </li>
        )}
        </ul>
      }
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => write([...rows, newParamRow()])}>
          <PlusIcon className="h-3.5 w-3.5" aria-hidden />
          Add a parameter
        </Button>
        <button type="button" className={cn(linkButton, 'text-[13px]')} onClick={() => setJson(true)}>
          Edit as JSON
        </button>
      </div>
      <div className="rounded-md bg-subtle px-3 py-2.5" aria-label="What the model sees">
        <p className="text-xs font-medium text-ink-soft">What the model sees</p>
        <code className="mt-1 block font-mono text-[13px] text-ink">{view.signature}</code>
        {view.params.length > 0 &&
        <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">
            {view.params.map((line) => <li key={line}>{line}</li>)}
          </ul>
        }
        <p className="mt-1.5 text-xs text-muted">
          In this tool’s request, write a parameter as <code className="font-mono">{'{{args.NAME}}'}</code>.
        </p>
      </div>
    </div>);

}
