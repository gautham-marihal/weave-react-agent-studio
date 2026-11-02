import React, { useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import type { AgentConfig } from '../../../../types/studio';
import { LANGUAGE_PATTERN, hasLanguage, languageProblem, languageStatus, primaryOf, toLanguages, toPlain, wantedLanguages, type MessageText } from '../../../../models/messages';
import { StatusChip } from '../../../ui/StatusChip';
import { Button } from '../../../ui/Button';
import { cn, inputClass, inputErrorClass } from '../../../../utils/styles';

/**
 * The text of a fixed line: one line for everyone, or one per language. Per language, every language the agent speaks
 * gets a row, so a missing one is plain to see (one click adds it) and the primary can't be left out.
 */
export function MessageTextEditor({ id, value, config, onChange, disabled, name }: { id: string; value: MessageText | undefined; config: AgentConfig; onChange: (v: MessageText) => void; disabled: boolean; name: string }) {
  const [adding, setAdding] = useState('');
  const [problem, setProblem] = useState('');
  const wanted = wantedLanguages(config);
  const primary = primaryOf(config);

  if (typeof value !== 'object' || value === null) {
    const text = typeof value === 'string' ? value : '';
    return (
      <div>
        <textarea id={id} rows={2} aria-label={`Text of ${name}`} className={cn(inputClass, 'resize-y', !text && inputErrorClass)} value={text} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        {!text && <p className="mt-1 text-[13px] text-danger">Empty. A line with no text is refused.</p>}
        {!disabled &&
        <button type="button" className="mt-1.5 text-[13px] font-medium text-accent hover:underline" onClick={() => onChange(toLanguages(value, config))}>
            Write it in more than one language{wanted.length > 1 ? ` (${wanted.join(', ')})` : ''}
          </button>
        }
      </div>);

  }

  const status = languageStatus(value, config);
  const isPrimary = (code: string) => !!primary && hasLanguage({ [code]: 1 }, primary);
  // the primary language first, then the others as they were written
  const written = Object.keys(value).sort((a, b) => Number(isPrimary(b)) - Number(isPrimary(a)));
  const submit = () => {
    const bad = languageProblem(adding, value);
    if (bad) {
      setProblem(bad);
      return;
    }
    onChange({ ...value, [adding.trim()]: '' });
    setAdding('');
    setProblem('');
  };

  return (
    <div className="space-y-2.5">
      {status.primaryMissing && <p className="text-[13px] text-danger">The main language ({primary}) needs a text. Without it, callers in that language have nothing to hear.</p>}
      {written.map((code, i) =>
      <div key={code} data-lang={code}>
          <div className="mb-1 flex items-center gap-2">
            <label htmlFor={i === 0 ? id : `${id}-${code}`} className="font-mono text-xs font-medium text-ink-soft">{code}</label>
            {isPrimary(code) && <StatusChip>main language</StatusChip>}
            {!disabled && !isPrimary(code) &&
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-subtle hover:text-danger"
            aria-label={`Delete the ${code} text of ${name}`}
            onClick={() => {
              const rest = { ...value };
              delete rest[code];
              onChange(rest);
            }}>
                <XIcon className="h-3 w-3" aria-hidden />
                Delete
              </button>
          }
          </div>
          <textarea
          id={i === 0 ? id : `${id}-${code}`}
          rows={2}
          aria-label={`Text of ${name} in ${code}`}
          className={cn(inputClass, 'resize-y', value[code] === '' && inputErrorClass)}
          value={value[code] ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, [code]: e.target.value })} />
          {value[code] === '' && <p className="mt-1 text-[13px] text-danger">Empty. A line with no text is refused.</p>}
        </div>
      )}
      {status.missing.length > 0 &&
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink" role="note">
          <span>
            The agent speaks {status.missing.join(', ')}, but this line has no text for {status.missing.length === 1 ? 'it' : 'them'}.
          </span>
          {!disabled &&
        status.missing.map((code) =>
        <Button key={code} size="sm" variant="ghost" onClick={() => onChange({ ...value, [code]: '' })}>
                <PlusIcon className="h-3.5 w-3.5" aria-hidden />
                Add {code}
              </Button>
        )}
        </div>
      }
      {!disabled &&
      <div className="flex flex-wrap items-center gap-2">
          <input
          className={cn(inputClass, 'h-8 w-48 py-1 font-mono text-[13px]', problem && inputErrorClass)}
          value={adding}
          placeholder="Another language, e.g. fr"
          aria-label={`Another language code for ${name}`}
          pattern={LANGUAGE_PATTERN.source}
          spellCheck={false}
          onChange={(e) => {
            setAdding(e.target.value);
            setProblem('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }} />
          <Button size="sm" variant="secondary" disabled={!adding.trim()} onClick={submit}>
            <PlusIcon className="h-3.5 w-3.5" aria-hidden />
            Add language
          </Button>
          <button type="button" className="text-[13px] font-medium text-accent hover:underline" onClick={() => onChange(toPlain(value, config))}>
            Use one text for every language
          </button>
          {problem && <p className="w-full text-[13px] text-danger" role="alert">{problem}</p>}
        </div>
      }
    </div>);

}
