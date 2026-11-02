import React from 'react';
import { ArrowDownIcon, ArrowUpIcon, XIcon } from 'lucide-react';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import { Toggle } from '../../../ui/Toggle';
import { Segmented } from '../../../ui/Segmented';
import {
  SOURCE_KINDS,
  callerIdOf,
  callerIdProblems,
  callerIdWords,
  newSource,
  setCallerId,
  startCallerId,
  type CallerSource,
  type Normalize,
  type SourceKind,
} from '../../../../models/channelsIdentity';
import { cn, inputClass } from '../../../../utils/styles';

/**
 * Caller identity (identity.caller_id): where the agent reads who is calling, tried in order, and how a phone number is
 * written. Off: the setting is left out and the server's default applies.
 */
export function IdentityCard({ editor }: { editor: DraftEditor }) {
  const config = editor.config;
  if (!config) return null;
  const disabled = !editor.canEdit;
  const c = callerIdOf(config);
  const write = (sources: CallerSource[], normalize: Normalize | null) => editor.replaceConfig(setCallerId(config, { sources, normalize }));
  const setSource = (i: number, next: CallerSource) => write(c.sources.map((s, n) => (n === i ? next : s)), c.normalize);
  const move = (i: number, to: number) => {
    if (to < 0 || to >= c.sources.length) return;
    const next = [...c.sources];
    const [item] = next.splice(i, 1);
    next.splice(to, 0, item);
    write(next, c.normalize);
  };
  const problems = callerIdProblems(c);
  const norm = c.normalize?.type ?? 'default';

  return (
    <div id="identity" className="rounded-lg border border-line bg-surface px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Read who is calling</p>
          <p className="mt-0.5 text-[13px] text-muted" data-note="caller-id">{callerIdWords(c)}</p>
        </div>
        <Toggle
          checked={c.on}
          onChange={(v) => editor.replaceConfig(setCallerId(config, v ? startCallerId() : null))}
          label="Read who is calling"
          disabled={disabled} />
      </div>

      {c.on &&
      <div className="mt-4 space-y-4">
          <div>
            <p className="text-[13px] font-medium text-ink-soft">Where it reads it, in order</p>
            <ol className="mt-1.5 space-y-2">
              {c.sources.map((s, i) =>
            <li key={i} className="rounded-md border border-line px-3 py-3" data-source={i}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium tabular-nums text-muted">{i + 1}.</span>
                    <select
                  aria-label={`Source ${i + 1}`}
                  className={cn(inputClass, 'w-56')}
                  value={s.from}
                  disabled={disabled}
                  onChange={(e) => setSource(i, newSource(e.target.value as SourceKind))}>
                      {SOURCE_KINDS.map((k) => <option key={k.from} value={k.from}>{k.label}</option>)}
                    </select>
                    <span className="ml-auto flex items-center gap-0.5">
                      <IconButton label={`Move source ${i + 1} up`} disabled={disabled || i === 0} onClick={() => move(i, i - 1)}><ArrowUpIcon className="h-3.5 w-3.5" aria-hidden /></IconButton>
                      <IconButton label={`Move source ${i + 1} down`} disabled={disabled || i === c.sources.length - 1} onClick={() => move(i, i + 1)}><ArrowDownIcon className="h-3.5 w-3.5" aria-hidden /></IconButton>
                      <IconButton label={`Remove source ${i + 1}`} disabled={disabled || c.sources.length === 1} onClick={() => write(c.sources.filter((_, n) => n !== i), c.normalize)}><XIcon className="h-3.5 w-3.5" aria-hidden /></IconButton>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{SOURCE_KINDS.find((k) => k.from === s.from)?.help}</p>
                  <div className="mt-2">
                    {s.from === 'participant_attribute' &&
                <input aria-label={`Detail name (source ${i + 1})`} className={cn(inputClass, 'font-mono text-[13px]')} value={s.name} placeholder="sip.phoneNumber" disabled={disabled} onChange={(e) => setSource(i, { ...s, name: e.target.value })} />
                }
                    {s.from === 'participant_identity' &&
                <label className="block">
                        <span className="text-xs text-muted">Patterns taken out, one per line</span>
                        <textarea
                    aria-label={`Patterns taken out (source ${i + 1})`}
                    rows={2}
                    className={cn(inputClass, 'mt-1 resize-y font-mono text-[13px]')}
                    value={(s.strip ?? []).join('\n')}
                    disabled={disabled}
                    onChange={(e) => {
                      const strip = e.target.value.split('\n').filter((p) => p !== '');
                      setSource(i, strip.length ? { from: s.from, strip } : { from: s.from });
                    }} />
                      </label>
                }
                    {s.from === 'static' &&
                <div className="grid gap-2 sm:grid-cols-2">
                        <input aria-label={`Value (source ${i + 1})`} className={cn(inputClass, 'font-mono text-[13px]')} value={s.value} placeholder="+15550100" disabled={disabled} onChange={(e) => setSource(i, { ...s, value: e.target.value })} />
                        <input
                    aria-label={`What it is (source ${i + 1})`}
                    className={inputClass}
                    value={s.description ?? ''}
                    placeholder="What it is, for your team"
                    disabled={disabled}
                    onChange={(e) => {
                      const next: { from: 'static'; value: string; description?: string } = { from: 'static', value: s.value };
                      if (e.target.value) next.description = e.target.value;
                      setSource(i, next);
                    }} />
                      </div>
                }
                  </div>
                </li>
            )}
            </ol>
            <select
            aria-label="Add a place to read it from"
            className={cn(inputClass, 'mt-2 w-64')}
            value=""
            disabled={disabled}
            onChange={(e) => e.target.value && write([...c.sources, newSource(e.target.value as SourceKind)], c.normalize)}>
              <option value="">Add a place to read it from…</option>
              {SOURCE_KINDS.map((k) => <option key={k.from} value={k.from}>{k.label}</option>)}
            </select>
          </div>

          <div>
            <p className="text-[13px] font-medium text-ink-soft">How a phone number is written</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <Segmented
              size="sm"
              label="How a phone number is written"
              value={norm}
              options={[
              { value: 'default', label: 'Server’s default' },
              { value: 'none', label: 'As it comes' },
              { value: 'e164', label: 'International form' }]
              }
              onChange={(v) => !disabled && write(c.sources, v === 'default' ? null : v === 'none' ? { type: 'none' } : { type: 'e164', default_country: c.normalize?.type === 'e164' ? c.normalize.default_country : '' })} />
              {c.normalize?.type === 'e164' &&
            <label className="flex items-center gap-2 text-[13px] text-ink-soft">
                  Country for numbers without a code
                  <input
                aria-label="Default country"
                className={cn(inputClass, 'w-16 font-mono uppercase')}
                maxLength={2}
                value={c.normalize.default_country}
                placeholder="US"
                disabled={disabled}
                onChange={(e) => write(c.sources, { type: 'e164', default_country: e.target.value.toUpperCase() })} />
                </label>
            }
            </div>
          </div>

          {problems.length > 0 &&
        <ul className="space-y-0.5 text-[13px] text-warning" role="note">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
        }
        </div>
      }
    </div>);

}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="rounded p-1 text-muted transition-colors duration-150 hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40">
      {children}
    </button>);

}
