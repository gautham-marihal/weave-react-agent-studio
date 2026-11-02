import React, { useEffect, useId, useMemo, useState } from 'react';
import { CheckIcon, PauseIcon, PlayIcon, SearchIcon } from 'lucide-react';
import type { AgentConfig } from '../../../../types/studio';
import type { Provider } from '../../../../api/types';
import { providerLabel } from '../../../../data/providers';
import { languageName } from '../../../../models/languages';
import { engineSwitchNote, filterVoices, readLanguages, voiceFilters, voiceHue, voiceInUse, type PickerVoice } from '../../../../models/pickers';
import { applyVoice, readModels, setVoiceId } from '../../../../models/pickersModels';
import { useVoiceSample } from './useVoiceSample';
import { cn, inputClass } from '../../../../utils/styles';

interface VoicePickerProps {
  config: AgentConfig;
  set: (next: AgentConfig) => void;
  /** The server's providers (GET /providers), or null when they could not be read. */
  providers: Provider[] | null;
  /** It talks somewhere (phone or website); an agent that only chats needs no voice yet. */
  speech: boolean;
  disabled?: boolean;
}

/**
 * An agent's voice, chosen from the catalogue: search, filter, listen and pick. Picking a voice of another engine also
 * switches the engine (and that engine's model), said under the list. A voice id from your own account can be typed.
 * The list opens filtered to the main language, with the voice in use on top.
 */
export function VoicePicker({ config, set, providers, speech, disabled }: VoicePickerProps) {
  const ownId = useId();
  const tts = readModels(config).tts;
  const filters = useMemo(() => voiceFilters(), []);
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState('');
  const [engine, setEngine] = useState('');
  const [language, setLanguage] = useState(() => {
    const main = languageName(readLanguages(config).primary);
    return filters.languages.includes(main) ? main : '';
  });
  // ordered by the voice the panel opened with, so the list doesn't jump on a pick
  const [opened] = useState(() => ({ provider: tts.provider, voiceId: tts.voiceId }));
  const inUse = voiceInUse(tts);
  const voices = useMemo(() => filterVoices({ query, gender, engine, language, current: opened }), [query, gender, engine, language, opened]);
  const sample = useVoiceSample();
  const [justSet, setJustSet] = useState('');
  const [ownOpen, setOwnOpen] = useState(!!tts.voiceId && !inUse);
  const custom = !!tts.voiceId && !inUse;
  const offered = (name: string) => (providers ?? []).some((p) => p.name === name && (p.stages ?? []).includes('tts') && p.installed !== false);

  // a sample hidden by a search or filter stops, so it never plays without its stop button
  const { playing, stop } = sample;
  useEffect(() => {
    if (playing && playing !== inUse?.id && !voices.some((v) => v.id === playing)) stop();
  }, [playing, inUse, voices, stop]);

  const choose = (voice: PickerVoice) => {
    set(applyVoice(config, { provider: voice.engine, voiceId: voice.voiceId }, providers));
    setJustSet(engineSwitchNote(voice, tts.provider));
  };
  const clear = () => {
    setQuery('');
    setGender('');
    setEngine('');
    setLanguage('');
  };
  const filtered = !!(query || gender || engine || language);
  const playButton = (voice: PickerVoice) =>
  <button
    type="button"
    onClick={() => sample.play(voice)}
    aria-label={sample.playing === voice.id ? `Stop ${voice.name}` : `Listen to ${voice.name}`}
    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-soft transition-colors duration-150 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      {sample.playing === voice.id ? <PauseIcon className="h-3.5 w-3.5" aria-hidden /> : <PlayIcon className="h-3.5 w-3.5" aria-hidden />}
    </button>;


  return (
    <div className="space-y-4">
      <section aria-label="The voice now" className="flex items-center gap-3 rounded-lg border border-line bg-canvas/60 px-4 py-3">
        {tts.voiceId ?
        <>
            <Avatar name={inUse?.name ?? tts.voiceId} />
            <span className="min-w-0 flex-1">
              <strong className="block text-sm font-medium text-ink">{inUse ? inUse.name : 'A voice from your own account'}</strong>
              <small className="block truncate text-xs text-muted">
                {inUse ? `${inUse.style} · ${inUse.language} · ${inUse.engineName}` : `${tts.voiceId}${tts.provider ? ` · ${providerLabel(tts.provider)}` : ''}`}
              </small>
            </span>
            {inUse && playButton(inUse)}
          </> :

        <span className="min-w-0">
            <strong className="block text-sm font-medium text-ink">{speech ? 'No voice chosen yet' : 'Not needed while it only chats'}</strong>
            <small className="block text-xs text-muted">{speech ? 'Pick one below. Listen first with the play button.' : 'Choose one for phone calls or talking on your website.'}</small>
          </span>
        }
      </section>

      <div className="space-y-2">
        <label className="relative block">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" className={cn(inputClass, 'pl-9')} value={query} placeholder="Search voices by name, style or language" aria-label="Search voices" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div role="group" aria-label="Filter voices" className="flex flex-wrap items-end gap-2">
          <Filter label="Gender" value={gender} onChange={setGender} options={filters.genders.map((g) => ({ value: g, label: g }))} />
          <Filter label="Engine" value={engine} onChange={setEngine} options={filters.engines} />
          <Filter label="Language" aria="Language of the voice" value={language} onChange={setLanguage} options={filters.languages.map((l) => ({ value: l, label: l }))} />
          {filtered &&
          <button type="button" onClick={clear} className="mb-2 text-[13px] font-medium text-accent hover:underline">
              Clear
            </button>
          }
        </div>
      </div>

      <ul aria-label="Voices" className="divide-y divide-line overflow-hidden rounded-lg border border-line">
        {voices.map((voice) => {
          const on = voice.voiceId === tts.voiceId && voice.engine === tts.provider.toLowerCase();
          return (
            <li key={voice.id} data-on={on || undefined} className={cn('flex items-center gap-2 pr-3', on ? 'bg-accent-soft/50' : 'bg-surface')}>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={on}
                aria-label={`${on ? 'Using' : 'Use'} ${voice.name}, ${voice.style}, ${voice.language}, ${voice.engineName}`}
                onClick={() => choose(voice)}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-subtle/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 disabled:cursor-not-allowed">
                <Avatar name={voice.name} />
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm font-medium text-ink">{voice.name}</strong>
                  <small className="block text-xs text-muted">
                    {voice.style} · {voice.gender} · {voice.language}
                  </small>
                </span>
                <span data-engine className="shrink-0 text-xs text-ink-soft">
                  {voice.engineName}
                  {providers && !offered(voice.engine) ? <em className="not-italic text-warning"> · not on this server</em> : null}
                </span>
                {on && <CheckIcon className="h-4 w-4 shrink-0 text-accent" aria-hidden />}
              </button>
              {playButton(voice)}
            </li>);

        })}
        {voices.length === 0 &&
        <li data-none className="px-4 py-3 text-[13px] text-muted">
            No voice matches.{' '}
            <button type="button" onClick={clear} className="font-medium text-accent hover:underline">
              Clear the search
            </button>
          </li>
        }
      </ul>
      {justSet &&
      <p role="status" className="rounded-md bg-info-soft px-3 py-2 text-[13px] text-ink-soft">
          {justSet}
        </p>
      }
      {sample.note && <p role="status" data-voice-note className="text-[13px] text-warning">{sample.note}</p>}
      <p className="text-xs text-muted">Each voice plays its own recording. Cartesia’s recordings come from a public voice directory, not from Cartesia itself.</p>

      <details open={ownOpen || custom} onToggle={(e) => setOwnOpen((e.currentTarget as HTMLDetailsElement).open)} className="rounded-lg border border-line px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-ink">A voice from your own account</summary>
        <div className="mt-3">
          <label htmlFor={ownId} className="text-[13px] font-medium text-ink">
            Voice id
          </label>
          <input
            id={ownId}
            className={cn(inputClass, 'mt-1 font-mono')}
            type="text"
            spellCheck={false}
            value={tts.voiceId}
            placeholder="The voice id shown by your provider"
            // a voice id needs an engine, so the engine comes first (an id already typed can still be cleared)
            disabled={disabled || !tts.provider && !tts.voiceId}
            onChange={(e) => set(setVoiceId(config, e.target.value))}
            aria-label="Voice id" />
          <p className="mt-1 text-xs text-muted">{tts.provider ? `Used with ${providerLabel(tts.provider)}.` : 'Pick any voice above first, to choose the engine this id is used with.'}</p>
        </div>
      </details>
    </div>);

}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
      style={{ backgroundColor: `hsl(${voiceHue(name)} 45% 46%)` }}>
      {name.charAt(0).toUpperCase()}
    </span>);

}

function Filter({ label, aria, value, onChange, options }: { label: string; aria?: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted">{label}</span>
      <select className={cn(inputClass, 'mt-1 w-auto py-1.5')} value={value} aria-label={aria ?? label} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {options.map((o) =>
        <option key={o.value} value={o.value}>
            {o.label}
          </option>
        )}
      </select>
    </label>);

}
