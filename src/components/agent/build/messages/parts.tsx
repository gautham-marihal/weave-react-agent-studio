import React, { useEffect, useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { Button } from '../../../ui/Button';
import { cn } from '../../../../utils/styles';

// Small pieces the Build pages share: a card, a picker of things to add by the job each does.

export function Card({ title, text, action, children, className }: { title: string; text?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn('rounded-xl border border-line bg-surface p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {text && <p className="mt-0.5 text-[13px] text-muted">{text}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>);

}

export interface AddChoice {
  id: string;
  group?: string;
  label: string;
  help: string;
}

/** A button that opens the things that can be added, grouped, each with a sentence saying what it does. */
export function AddChoices({ label, choices, onPick, disabled }: { label: string; choices: AddChoice[]; onPick: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const groups = Array.from(new Set(choices.map((c) => c.group ?? '')));
  return (
    <div className="w-full">
      <Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={disabled}>
        <PlusIcon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </Button>
      {open &&
      <div className="mt-3 space-y-3 rounded-lg border border-line bg-canvas p-3" role="group" aria-label={label}>
          {groups.map((g) =>
        <div key={g || 'all'}>
              {g && <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{g}</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {choices.
            filter((c) => (c.group ?? '') === g).
            map((c) =>
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(c.id);
              }}
              className="rounded-lg border border-line bg-surface px-3 py-2.5 text-left transition-colors duration-150 hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                      <span className="block text-sm font-medium text-ink">{c.label}</span>
                      <span className="mt-0.5 block text-xs text-muted">{c.help}</span>
                    </button>
            )}
              </div>
            </div>
        )}
        </div>
      }
    </div>);

}

/** A list of short values, one per line, in a box (patterns, field names). Empty lines are dropped on the way out. */
export function LinesInput({ id, value, onChange, disabled, placeholder, label, mono = true }: { id?: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; placeholder?: string; label: string; mono?: boolean }) {
  // the box keeps what is typed (blank lines included) until it is left; the config gets the clean list
  const [text, setText] = useState(value.join('\n'));
  const joined = value.join('\n');
  useEffect(() => {
    setText((t) => (t.split('\n').map((s) => s.trim()).filter(Boolean).join('\n') === joined ? t : joined));
  }, [joined]);
  return (
    <textarea
      id={id}
      aria-label={label}
      rows={Math.max(2, Math.min(8, text.split('\n').length))}
      className={cn('w-full resize-y rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-subtle disabled:text-muted', mono && 'font-mono text-[13px]')}
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      spellCheck={!mono}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean));
      }} />);


}
