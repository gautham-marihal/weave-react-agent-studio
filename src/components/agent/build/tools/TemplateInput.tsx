import React, { useRef, useState } from 'react';
import { insertAt, insertables, templateProblems, type TemplateScope } from '../../../../models/toolsPaths';
import { cn, inputClass } from '../../../../utils/styles';

interface TemplateInputProps {
  value: string;
  onChange: (value: string) => void;
  scope: TemplateScope;
  label: string;
  id?: string;
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
  disabled?: boolean;
}

/**
 * A text the runtime fills in ({{args.order_id}}, {{state.name}}): while it has focus it offers the names this config
 * has, to insert at the caret, and under it a hint for a name that points at nothing (only a hint: the server decides).
 */
export function TemplateInput({ value, onChange, scope, label, id, placeholder, multiline, mono = true, disabled }: TemplateInputProps) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const chips = insertables(scope);
  const problems = templateProblems(value, scope);
  const insert = (snippet: string) => {
    const el = ref.current;
    const next = insertAt(value, el?.selectionStart, el?.selectionEnd, snippet);
    onChange(next.text);
    window.requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  };
  const props = {
    ref,
    id,
    'aria-label': label,
    value,
    placeholder,
    disabled,
    spellCheck: false,
    className: cn(inputClass, mono && 'font-mono text-[13px]', multiline && 'resize-y'),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
  };
  return (
    <div
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}>
      {multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}
      {open && !disabled && chips.length > 0 &&
      <div className="mt-1.5 flex flex-wrap items-center gap-1" aria-label={`Names to insert into ${label}`}>
          <span className="text-xs text-muted">Insert</span>
          {chips.slice(0, 12).map((c) =>
        <button
          key={c.snippet}
          type="button"
          title={`Insert ${c.snippet} (${c.group})`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert(c.snippet)}
          className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-ink-soft transition-colors duration-150 hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              {c.label}
            </button>
        )}
        </div>
      }
      {problems.slice(0, 2).map((p) =>
      <p key={`${p.start}-${p.text}`} className="mt-1 text-xs text-warning">
          <code className="font-mono">{p.text}</code>: {p.reason}
        </p>
      )}
    </div>);

}
