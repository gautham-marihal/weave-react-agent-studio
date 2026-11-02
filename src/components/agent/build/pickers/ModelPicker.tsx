import React, { useMemo, useState } from 'react';
import { CheckIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react';
import type { AgentConfig } from '../../../../types/studio';
import type { Provider } from '../../../../api/types';
import type { ModelStage } from '../../../../data/providers';
import { providerLabel } from '../../../../data/providers';
import { STAGES, modelLabel, modelRows, modelStatus, providerChips, readModels, setModel, setProvider, slotProblem } from '../../../../models/pickersModels';
import { Button } from '../../../ui/Button';
import { cn, inputClass } from '../../../../utils/styles';

interface ModelPickerProps {
  config: AgentConfig;
  set: (next: AgentConfig) => void;
  /** The server's providers (GET /providers); null when they could not be read. */
  providers: Provider[] | null;
  /** Why the list could not be read, when it couldn't. */
  providersError?: string | null;
  /** It talks somewhere; without it, hearing and speaking are marked not needed (but can still be chosen). */
  speech: boolean;
  disabled?: boolean;
}

/**
 * The three parts of a call in the order people think of them: what thinks (language model), listens (speech-to-text)
 * and speaks (text-to-speech). Each card shows the choice and what would stop it (a missing key, a provider the server
 * can't run); "Change" opens a searchable list built from the server's providers and the model catalogue.
 */
export function ModelPicker({ config, set, providers, providersError, speech, disabled }: ModelPickerProps) {
  const models = readModels(config);
  const [open, setOpen] = useState<ModelStage | ''>(() => STAGES.find((p) => !models[p.id].provider && (speech || p.id === 'llm'))?.id ?? '');
  return (
    <div className="space-y-4">
      {!providers &&
      <p role="note" className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink">
          <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          <span>
            What the server can run could not be checked{providersError ? ` (${providersError})` : ''}. Nothing is listed to choose from until it can be; you can still type a model id for the provider in use.
          </span>
        </p>
      }
      {STAGES.map((part) =>
      <PartCard key={part.id} part={part} config={config} set={set} providers={providers} open={open === part.id} onToggle={() => setOpen(open === part.id ? '' : part.id)} speech={speech} disabled={disabled} />
      )}
      <p className="text-xs text-muted">Models come from a catalogue kept in the studio, not a live check. Any other model id can be typed: the server doesn’t check model ids.</p>
    </div>);

}

function PartCard({ part, config, set, providers, open, onToggle, speech, disabled }: { part: (typeof STAGES)[number]; config: AgentConfig; set: (next: AgentConfig) => void; providers: Provider[] | null; open: boolean; onToggle: () => void; speech: boolean; disabled?: boolean }) {
  const notNeeded = !speech && part.id !== 'llm';
  const slot = readModels(config)[part.id];
  const status = slot.provider ? modelStatus(part.id, slot.provider, slot.model) : null;
  const problem = slotProblem(part.id, slot, providers);
  return (
    <section data-stage={part.id} aria-label={part.title} className={cn('rounded-lg border bg-surface', open ? 'border-accent/60' : 'border-line')}>
      <div className="flex items-start justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{part.title}</h3>
          <p className="text-[13px] text-muted">{part.what}</p>
          <div data-chosen className="mt-2">
            {slot.provider ?
            <>
                <strong className="block text-sm font-medium text-ink">{slot.model ? modelLabel(part.id, slot.provider, slot.model) : 'No model chosen'}</strong>
                <small className="block text-xs text-muted">
                  {providerLabel(slot.provider)}
                  {slot.model && modelLabel(part.id, slot.provider, slot.model) !== slot.model ? ` · ${slot.model}` : ''}
                </small>
              </> :

            <>
                <strong className="block text-sm font-medium text-ink">{notNeeded ? 'Not needed while it only chats' : 'Nothing chosen yet'}</strong>
                <small className="block text-xs text-muted">{notNeeded ? 'Choose one for phone calls or talking on your website.' : 'The server’s default is used until you choose.'}</small>
              </>
            }
          </div>
        </div>
        <Button size="sm" variant="secondary" aria-expanded={open} aria-label={`${open ? 'Close the list of' : 'Change'} ${part.title} models`} onClick={onToggle}>
          {open ? 'Done choosing' : slot.provider ? 'Change' : 'Choose'}
        </Button>
      </div>
      {problem &&
      <p data-problem className="mx-4 mb-3 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink">
          <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
          {problem.text}
        </p>
      }
      {status && status.state !== 'listed' && <p data-status={status.state} className="mx-4 mb-3 text-xs text-muted">{status.text}</p>}
      {open && <ModelList part={part} config={config} set={set} providers={providers} disabled={disabled} />}
    </section>);

}

function ModelList({ part, config, set, providers, disabled }: { part: (typeof STAGES)[number]; config: AgentConfig; set: (next: AgentConfig) => void; providers: Provider[] | null; disabled?: boolean }) {
  const slot = readModels(config)[part.id];
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [other, setOther] = useState('');
  const chips = useMemo(() => providerChips({ stage: part.id, providers }), [part.id, providers]);
  const rows = useMemo(
    () => modelRows({ stage: part.id, providers, query, provider: filter, current: { provider: slot.provider, model: slot.model } }),
    [part.id, providers, query, filter, slot.provider, slot.model]
  );
  const choose = (provider: string, model: string) => {
    let next = config;
    if (provider !== slot.provider) next = setProvider(next, part.id, provider, providers);
    set(setModel(next, part.id, model));
  };
  const base = slot.provider || filter || chips.find((c) => c.installed)?.value || '';
  const chooseOther = () => {
    const id = other.trim();
    if (!id || !base) return;
    choose(base, id);
    setOther('');
  };
  return (
    <div className="space-y-3 border-t border-line px-4 py-3">
      {providers &&
      <>
          <label className="relative block">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input type="search" className={cn(inputClass, 'pl-9')} value={query} placeholder={`Search ${part.title.toLowerCase()} models`} aria-label={`Search ${part.title} models`} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div role="group" aria-label="Provider" className="flex flex-wrap gap-1.5">
            {[{ value: '', label: 'All', installed: true }, ...chips].map((c) =>
          <button
            key={c.value || 'all'}
            type="button"
            aria-pressed={filter === c.value}
            onClick={() => setFilter(filter === c.value ? '' : c.value)}
            className={cn('rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40', filter === c.value ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:border-line-strong')}>
                {c.label}
                {!c.installed ? ' (not installed)' : ''}
              </button>
          )}
          </div>
          <ul aria-label={`${part.title} models`} className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {rows.map((row) =>
          <li key={`${row.provider}/${row.id}`} data-on={row.selected || undefined}>
                <button
              type="button"
              aria-pressed={row.selected}
              aria-label={`${row.selected ? 'Using' : 'Use'} ${row.label} from ${row.providerName}`}
              // a provider not installed on the server can't run: shown, but not choosable (unless already in use)
              disabled={disabled || !row.installed && !row.selected}
              title={!row.installed ? `${row.providerName} isn’t installed on this server, so its models can’t run here.` : undefined}
              onClick={() => choose(row.provider, row.id)}
              className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-subtle/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60', row.selected && 'bg-accent-soft/50')}>
                  <span className="min-w-0 flex-1">
                    <strong className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
                      {row.label}
                      {row.recommended && <em className="rounded bg-success-soft px-1.5 py-0.5 text-[11px] font-medium not-italic text-success">Recommended</em>}
                      {row.tags.slice(0, 2).map((t) =>
                  <em key={t} className="rounded bg-subtle px-1.5 py-0.5 text-[11px] font-medium not-italic text-ink-soft">
                          {t}
                        </em>
                  )}
                    </strong>
                    <small className="block text-xs text-muted">{row.note || row.id}</small>
                  </span>
                  <span data-engine className="shrink-0 text-xs text-ink-soft">
                    {row.providerName}
                    {!row.installed ? <em className="not-italic text-warning"> · not installed</em> : row.keyMissing ? <em className="not-italic text-warning" title={`${row.keyMissing} is not set on the server`}> · no key</em> : null}
                  </span>
                  {row.selected && <CheckIcon className="h-4 w-4 shrink-0 text-accent" aria-hidden />}
                </button>
              </li>
          )}
            {rows.length === 0 && <li className="px-3 py-2.5 text-[13px] text-muted">No model matches.</li>}
          </ul>
        </>
      }
      <div>
        <label htmlFor={`pk-other-${part.id}`} className="text-[13px] font-medium text-ink">
          Another model id
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={`pk-other-${part.id}`}
            className={cn(inputClass, 'font-mono')}
            type="text"
            spellCheck={false}
            value={other}
            disabled={disabled || !base}
            placeholder={base ? `Any model of ${providerLabel(base)}` : 'Choose a provider first'}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                chooseOther();
              }
            }} />
          <Button variant="secondary" disabled={disabled || !other.trim() || !base} onClick={chooseOther}>
            Use it
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted">The server doesn’t check model ids; a wrong one fails when a call starts.</p>
      </div>
    </div>);

}
