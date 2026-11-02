import React, { useRef } from 'react';
import { PlusIcon, TriangleAlertIcon } from 'lucide-react';
import { highlightSegments, insertAt, insertables, templateProblems, wordCount, type TemplateScope } from '../../../../models/templates';
import { cn, inputClass, inputErrorClass } from '../../../../utils/styles';

interface TemplateFieldProps {
  id?: string;
  value: string;
  onChange: (text: string) => void;
  scope: TemplateScope;
  ariaLabel: string;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  invalid?: boolean;
  /** Add a word count (for text a model is given). */
  showCount?: boolean;
}

/**
 * A text box for words the runtime fills in as it goes ({{state.x}}, {{const.x}}): "Insert a detail" puts one where the
 * cursor is. A name that may point at nothing is hinted in amber, never red: only the server's check is certain.
 */
export function TemplateField({ id, value, onChange, scope, ariaLabel, placeholder, rows = 8, disabled, invalid, showCount }: TemplateFieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // whether the box has had the cursor: until then no place in it was chosen, so a detail goes at the end
  const placed = useRef(false);
  const text = value ?? '';
  const problems = templateProblems(text, scope);
  const chips = insertables(scope).filter((c) => c.group !== 'argument');
  const count = wordCount(text);

  const insert = (snippet: string) => {
    const el = ref.current;
    const start = placed.current ? el?.selectionStart ?? text.length : text.length;
    const end = placed.current ? el?.selectionEnd ?? start : start;
    // at the end of the words, after a space, so it isn't glued to the last one
    const spaced = !placed.current && text && !/\s$/.test(text) ? ` ${snippet}` : snippet;
    placed.current = true;
    const result = insertAt(text, start, end, spaced);
    onChange(result.text);
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(result.caret, result.caret);
    });
  };

  return (
    <div className="space-y-2">
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onFocus={() => {
          placed.current = true;
        }}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputClass, 'resize-y leading-relaxed', invalid && inputErrorClass)} />
      {text.includes('{{') &&
      <p aria-label="How the details read" className="whitespace-pre-wrap rounded-md border border-line bg-canvas/60 px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
          {highlightSegments(text, scope).map((segment, i) =>
        <span key={i} className={cn(segment.kind === 'tpl' && 'rounded bg-accent-soft px-0.5 font-mono text-[12px] text-accent', segment.kind === 'unknown' && 'rounded bg-warning-soft px-0.5 font-mono text-[12px] text-warning')}>
              {segment.text}
            </span>
        )}
        </p>
      }
      {problems.map((problem, i) =>
      <p key={i} role="note" className="flex items-start gap-1.5 text-[13px] text-warning">
          <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <code className="font-mono">{problem.text}</code> {problem.reason}
          </span>
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-2">
        {!disabled ?
        <details className="group min-w-0 flex-1">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-accent hover:underline">
              <PlusIcon className="h-3.5 w-3.5" aria-hidden />
              Insert a detail
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.length === 0 && <span className="text-[13px] text-muted">Nothing to insert yet. What it keeps during a call, and fixed values you set, show here.</span>}
              {chips.map((chip) =>
            <button
              key={chip.label}
              type="button"
              title={`${chip.group === 'state' ? 'What it keeps during the call' : 'A fixed value'}: inserts ${chip.snippet}`}
              onClick={() => insert(chip.snippet)}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors duration-150 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                  {chip.plain}
                </button>
            )}
            </div>
          </details> :
        <span />}
        {showCount &&
        <small data-count className="shrink-0 text-xs text-muted">
            {count} {count === 1 ? 'word' : 'words'}
          </small>
        }
      </div>
    </div>);

}
