import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckIcon, CopyIcon, MicIcon, PauseIcon, PlayIcon, SearchIcon, SearchXIcon, StarIcon } from 'lucide-react';
import { toast } from '../ui/Toast';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { Field } from '../ui/Field';
import { AgentPickerDialog } from '../manage/AgentPickerDialog';
import { VOICE_CATALOG, type CatalogVoice } from '../../data/voiceCatalog';
import { ttsProviders } from '../../data/providers';
import type { Provider } from '../../api/types';
import type { Agent } from '../../types/studio';
import { useBrowserStore, useWorkspaceAgents } from '../../hooks/useWorkspaces';
import { favouriteVoicesStore, toggleFavouriteVoice, voiceUsage } from '../../models/voiceUsage';
import { queueChange } from '../../models/pendingChange';
import { voiceChange } from '../../models/manageChanges';
import { targetPath } from '../../models/agentPages';
import { copyText } from '../manage/download';
import { cn, inputClass } from '../../utils/styles';
import { isSandbox } from '../../sandbox/mode';

const all = <T extends string>(values: T[]) => [...new Set(values)];

/** A voice to put on an agent: one from the library, or a provider voice id typed on the Custom voices tab. */
interface VoicePick {
  name: string;
  provider: string;
  voiceId: string;
}

/**
 * The voice library: listen to a voice's own recorded sample, copy its id, see which agents use it, star favourites, and
 * "Use in an agent", which puts the voice on that agent's draft (unsaved, to review). Custom voices: any provider voice
 * id, used the same way.
 */
export function VoicesPanel({ providers }: { providers: Provider[] }) {
  const navigate = useNavigate();
  const agents = useWorkspaceAgents();
  const favourites = useBrowserStore(favouriteVoicesStore);
  const [section, setSection] = useState<'library' | 'custom'>('library');
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('All');
  const [gender, setGender] = useState('All');
  const [locale, setLocale] = useState('All');
  const [onlyFavourites, setOnlyFavourites] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [picking, setPicking] = useState<VoicePick | null>(null);

  // Which agents speak with each voice, from their saved drafts.
  const usage = useMemo(() => voiceUsage(VOICE_CATALOG, agents, Object.fromEntries(agents.map((a) => [a.id, a.loadError ? null : a.draft.config]))), [agents]);
  const keyReady = useMemo(() => new Map(providers.map((p) => [p.name.toLowerCase(), !!p.key_available])), [providers]);

  // Sandbox only: what the browser's own voice is reading, said under the filters
  const [browserNote, setBrowserNote] = useState('');
  const speaking = useRef(false);
  const quiet = useCallback(() => {
    if (!speaking.current) return;
    speaking.current = false;
    void import('../../sandbox/browserVoicePreview').then((m) => m.stopBrowserVoice());
  }, []);

  // a sample that is filtered away (or a tab that is left) must not go on playing with no button to stop it
  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    quiet();
    setPlaying(null);
  };
  useEffect(
    () => () => {
      audioRef.current?.pause();
      quiet();
    },
    [quiet]
  );

  // Sandbox: a voice whose recording can't be played is read by the browser's own voice, and the note says so
  const readAloud = async (voice: CatalogVoice, hadSample: boolean) => {
    const { readAloudInBrowser } = await import('../../sandbox/browserVoicePreview');
    const done = () => {
      speaking.current = false;
      setPlaying((now) => (now === voice.id ? null : now));
    };
    const said = readAloudInBrowser(voice, { hadSample, onDone: done });
    speaking.current = said.speaking;
    setBrowserNote(said.note);
    setPlaying(said.speaking ? voice.id : null);
  };

  // Only the provider's own recording of that voice is played; a voice without one says so instead (in Live).
  const togglePlay = (voice: CatalogVoice) => {
    if (playing === voice.id) {
      stop();
      return;
    }
    audioRef.current?.pause();
    quiet();
    setBrowserNote('');
    if (!voice.previewUrl) {
      if (isSandbox()) void readAloud(voice, false);
      return;
    }
    const audio = new Audio(voice.previewUrl);
    audioRef.current = audio;
    setPlaying(voice.id);
    let failedOnce = false;
    const failed = () => {
      if (failedOnce || audioRef.current !== audio) return;
      failedOnce = true;
      audioRef.current = null;
      if (isSandbox()) {
        void readAloud(voice, true);
        return;
      }
      setPlaying((now) => (now === voice.id ? null : now));
      toast.error('Couldn’t play the sample', { description: 'The provider’s recording could not be loaded.' });
    };
    audio.onended = () => setPlaying((now) => (now === voice.id ? null : now));
    audio.onerror = () => (isSandbox() ? failed() : setPlaying((now) => (now === voice.id ? null : now)));
    audio.play().catch(failed);
  };

  const copy = async (voice: CatalogVoice) => {
    const ok = await copyText(voice.voiceId);
    setCopied(ok ? voice.voiceId : null);
    if (ok) toast.success('Voice ID copied', { description: voice.voiceId });
    else toast.error('Couldn’t copy', { description: 'Select the ID and copy it.' });
    window.setTimeout(() => setCopied((now) => (now === voice.voiceId ? null : now)), 2000);
  };

  const voiceProviders = useMemo(() => all(VOICE_CATALOG.map((v) => v.provider)), []);
  const locales = useMemo(() => all(VOICE_CATALOG.map((v) => v.locale)).map((l) => ({ locale: l, label: VOICE_CATALOG.find((v) => v.locale === l)?.language ?? l })), []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return VOICE_CATALOG.filter((v) => {
      const text = `${v.name} ${v.style} ${v.language} ${v.tags.join(' ')}`.toLowerCase();
      return (
        (!q || text.includes(q)) &&
        (provider === 'All' || v.provider === provider) &&
        (gender === 'All' || v.gender === gender) &&
        (locale === 'All' || v.locale === locale) &&
        (!onlyFavourites || favourites.includes(v.id)));

    });
  }, [query, provider, gender, locale, onlyFavourites, favourites]);
  useEffect(() => {
    if (playing && (section !== 'library' || !filtered.some((v) => v.id === playing))) {
      audioRef.current?.pause();
      audioRef.current = null;
      quiet();
      setPlaying(null);
    }
  }, [playing, section, filtered, quiet]);

  const clear = () => {
    setQuery('');
    setProvider('All');
    setGender('All');
    setLocale('All');
    setOnlyFavourites(false);
  };

  const useIn = (agent: Agent) => {
    if (!picking) return;
    const change = voiceChange(picking);
    queueChange(agent.id, change);
    setPicking(null);
    navigate(change.target ? targetPath(agent.id, change.target) : `/agents/${agent.id}`);
  };

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Voice library sections"
          size="sm"
          value={section}
          onChange={setSection}
          options={[
          { value: 'library', label: 'Library voices' },
          { value: 'custom', label: 'Custom voices' }]
          } />
        <div className="flex flex-wrap items-center gap-3" aria-label="Provider keys on the server">
          {voiceProviders.map((name) => {
            const ready = keyReady.get(name.toLowerCase());
            return (
              <span key={name} className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-soft">
                <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', ready ? 'bg-success' : 'bg-line-strong')} />
                {name} {ready ? 'key set' : 'no key'}
              </span>);

          })}
        </div>
      </div>

      {section === 'custom' ?
      <CustomVoices providers={providers} onUse={setPicking} /> :

      <>
          <p className="mt-4 text-[13px] text-muted">
            Play a voice’s own recorded sample, see which agents use it, and use it in an agent. The voice lands in that agent’s draft for you to review and
            save.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:max-w-xs">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
              type="search"
              aria-label="Search voices"
              placeholder="Search voices, styles, accents…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={cn(inputClass, 'h-9 pl-9 text-[13px]')} />
            </div>
            <Segmented
            label="Provider"
            size="sm"
            value={provider}
            onChange={setProvider}
            options={[{ value: 'All', label: 'All providers' }, ...voiceProviders.map((p) => ({ value: p, label: p }))]} />
            <Segmented
            label="Gender"
            size="sm"
            value={gender}
            onChange={setGender}
            options={[
            { value: 'All', label: 'Any' },
            { value: 'Female', label: 'Female' },
            { value: 'Male', label: 'Male' }]
            } />
            <select aria-label="Language" value={locale} onChange={(e) => setLocale(e.target.value)} className={cn(inputClass, 'h-9 w-auto py-1 text-[13px]')}>
              <option value="All">All languages</option>
              {locales.map((l) =>
            <option key={l.locale} value={l.locale}>{l.label}</option>
            )}
            </select>
            <button
            type="button"
            aria-pressed={onlyFavourites}
            onClick={() => setOnlyFavourites((v) => !v)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              onlyFavourites ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-ink'
            )}>
              <StarIcon className={cn('h-3.5 w-3.5', onlyFavourites && 'fill-current')} aria-hidden />
              Favourites ({favourites.length})
            </button>
            <span className="ml-auto text-xs tabular-nums text-muted" aria-live="polite">
              {filtered.length} of {VOICE_CATALOG.length}
            </span>
          </div>

          {browserNote &&
        <p role="status" data-voice-note className="mt-4 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink-soft">
              <span className="font-medium text-warning">Sandbox · your browser’s voice. </span>
              {browserNote}
            </p>
        }
          {filtered.length === 0 ?
        <div className="mt-5 rounded-xl border border-dashed border-line px-6 py-12 text-center">
              <SearchXIcon className="mx-auto h-6 w-6 text-muted" aria-hidden />
              <p className="mt-2 text-sm font-medium text-ink">{onlyFavourites && !favourites.length ? 'No favourite voices yet' : 'No voices match'}</p>
              <button type="button" onClick={clear} className="mt-1 text-xs font-medium text-accent hover:underline">Clear the filters</button>
            </div> :

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((voice) => {
            const isPlaying = playing === voice.id;
            const users = usage[voice.id] ?? [];
            const favourite = favourites.includes(voice.id);
            const extraTags = voice.tags.filter((t) => t !== voice.style && !voice.language.includes(t));
            return (
              <div
                key={voice.id}
                data-voice={voice.id}
                className={cn(
                  'group flex flex-col rounded-xl border bg-surface p-4 transition-[border-color,box-shadow] duration-150',
                  isPlaying ? 'border-accent/60 shadow-card ring-1 ring-accent/30' : 'border-line hover:border-line-strong hover:shadow-card'
                )}>
                    <div className="flex items-center gap-3">
                      <button
                    type="button"
                    onClick={() => togglePlay(voice)}
                    disabled={!voice.previewUrl && !isSandbox()}
                    className={cn(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40',
                      isPlaying ? 'bg-accent text-white shadow-sm' : 'bg-accent-soft text-accent hover:bg-accent hover:text-white'
                    )}
                    aria-label={isPlaying ? `Stop ${voice.name}` : `Listen to ${voice.name}`}
                    title={!voice.previewUrl ? (isSandbox() ? 'There is no recorded sample: your browser’s own voice reads it (Sandbox)' : 'There is no recorded sample of this voice') : isPlaying ? 'Stop' : 'Hear the recorded sample'}>
                        {isPlaying ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="ml-0.5 h-4 w-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="truncate text-sm font-semibold text-ink">{voice.name}</h3>
                          <span className="shrink-0 text-[11px] font-medium text-muted">{voice.provider}</span>
                        </div>
                        <p className="truncate text-xs text-ink-soft">{voice.style}</p>
                      </div>
                      <button
                    type="button"
                    aria-pressed={favourite}
                    aria-label={favourite ? `Remove ${voice.name} from favourites` : `Add ${voice.name} to favourites`}
                    title={favourite ? 'Favourite (kept in this browser)' : 'Add to favourites (kept in this browser)'}
                    onClick={() => toggleFavouriteVoice(voice.id)}
                    className={cn('rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40', favourite ? 'text-warning' : 'text-muted/60 hover:text-ink')}>
                        <StarIcon className={cn('h-4 w-4', favourite && 'fill-current')} aria-hidden />
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1">
                      {[voice.gender, voice.language, ...extraTags].map((t) =>
                  <span key={t} className="rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink-soft">{t}</span>
                  )}
                    </div>

                    <div className="mt-3 text-xs" data-testid="used-by">
                      {users.length ?
                  <span className="flex flex-wrap items-center gap-1" title={users.map((a) => a.name).join(', ')}>
                          <span className="text-muted">Used by</span>
                          {users.slice(0, 2).map((a) =>
                    <span key={a.id} className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">{a.name}</span>
                    )}
                          {users.length > 2 && <span className="text-muted">+{users.length - 2}</span>}
                        </span> :

                  <span className="text-muted">Not in use</span>
                  }
                    </div>

                    <div className="mt-auto flex items-center gap-2 pt-4">
                      <code className="min-w-0 flex-1 truncate rounded-md bg-canvas px-2 py-1 font-mono text-[11px] text-ink-soft ring-1 ring-inset ring-line" title={voice.voiceId}>
                        {voice.voiceId}
                      </code>
                      <button
                    type="button"
                    onClick={() => void copy(voice)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    aria-label={`Copy voice ID for ${voice.name}`}
                    title="Copy voice ID">
                        {copied === voice.voiceId ? <CheckIcon className="h-3.5 w-3.5 text-success" /> : <CopyIcon className="h-3.5 w-3.5" />}
                      </button>
                      <Button size="sm" variant="secondary" onClick={() => setPicking({ name: voice.name, provider: voice.provider, voiceId: voice.voiceId })}>
                        Use in an agent
                      </Button>
                    </div>
                  </div>);

          })}
            </div>
        }
          <p className="mt-4 text-xs text-muted">Favourites are kept in this browser.</p>
        </>
      }

      {picking &&
      <AgentPickerDialog
        title={`Use ${picking.name} in an agent`}
        description="The voice is set on the agent’s draft. You review it there and save."
        agents={agents}
        onPick={useIn}
        onClose={() => setPicking(null)} />

      }
    </div>);

}

/**
 * Custom voices: voice cloning and uploads have no endpoint in the Agent Builder API, so they are not offered. A voice
 * of your own provider account can still be used by its id.
 */
function CustomVoices({ providers, onUse }: { providers: Provider[]; onUse: (pick: VoicePick) => void }) {
  // the providers that speak: GET /providers when it has answered, else Studio's text-to-speech catalogue
  const choices = useMemo(() => {
    const fromServer = providers.filter((p) => p.stages.includes('tts')).map((p) => ({ id: p.name, label: ttsProviders.find((t) => t.id === p.name)?.label ?? p.name, installed: p.installed }));
    return fromServer.length ? fromServer : ttsProviders.map((t) => ({ id: t.id, label: t.label, installed: true }));
  }, [providers]);
  const [provider, setProvider] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [name, setName] = useState('');
  const chosen = provider || choices[0]?.id || '';
  const label = choices.find((c) => c.id === chosen)?.label ?? chosen;
  const ready = !!chosen && !!voiceId.trim();
  return (
    <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <MicIcon className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink">Use a voice from your own provider account</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              Cloning a voice or uploading one is not available: the Agent Builder API has no endpoint for it. If your provider account has a voice of its own
              (a cloned or designed voice), type its id here and use it in an agent. Studio can’t play it: only the library’s recorded samples can be played.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field id="custom-voice-provider" label="Provider">
            <select id="custom-voice-provider-input" className={inputClass} value={chosen} onChange={(e) => setProvider(e.target.value)}>
              {choices.map((c) =>
              <option key={c.id} value={c.id} disabled={!c.installed}>{c.label}{c.installed ? '' : ' (not installed on the server)'}</option>
              )}
            </select>
          </Field>
          <Field id="custom-voice-id" label="Voice id" help="As your provider shows it.">
            <input id="custom-voice-id-input" className={cn(inputClass, 'font-mono')} value={voiceId} onChange={(e) => setVoiceId(e.target.value)} spellCheck={false} autoComplete="off" />
          </Field>
          <Field id="custom-voice-name" label="A name for it (optional)" help="Only used in the note the agent shows.">
            <input id="custom-voice-name-input" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Our brand voice" />
          </Field>
        </div>
        <div className="mt-5">
          <Button variant="primary" disabled={!ready} onClick={() => onUse({ name: name.trim() || voiceId.trim(), provider: label, voiceId: voiceId.trim() })}>
            Use in an agent
          </Button>
        </div>
      </div>
      <div className="rounded-xl border border-dashed border-line p-5 text-[13px] leading-relaxed text-muted">
        <p className="font-medium text-ink">What happens</p>
        <p className="mt-1">You choose the agent; the voice is set on its draft (Build › Agent › Voice) and not saved until you save it there.</p>
        <p className="mt-2">The server checks the provider’s key when you publish and deploy; whether your account may use a voice is up to the provider.</p>
      </div>
    </div>);

}
