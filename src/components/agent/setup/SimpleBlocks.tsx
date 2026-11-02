import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { FileTextIcon, GlobeIcon, LoaderCircleIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import type { AgentConfig } from '../../../types/studio';
import type { DraftEditor } from '../../../hooks/useDraftEditor';
import { useProviders } from '../../../hooks/useProviders';
import { starters } from '../../../data/starters';
import { LANGUAGES, languageName } from '../../../models/languages';
import { readingOf, type KnowledgeReading } from '../../../models/readiness';
import {
  ACTIONS,
  DETAIL_FIELDS,
  KNOWLEDGE_ID,
  REACH,
  actionsOf,
  addKnowledgeFile,
  addKnowledgePage,
  cleanUrl,
  entryIndex,
  isStarterRole,
  knowledgeOf,
  numberProblem,
  reachOf,
  removeKnowledge,
  setDetails,
  setEndCall,
  setHandOver,
  setLookup,
  setPrimaryLanguage,
  setReach,
  voicesFor,
  type ActionId,
} from '../../../models/setup';
import { providersFor } from '../../../utils/providerOptions';
import { providerFollowUps } from '../../../utils/settingOptions';
import { factsVersion, getFacts, loadFacts, subscribeFacts } from '../../../utils/agentFacts';
import { api } from '../../../api/client';
import { putAt } from '../../../utils/path';
import { Toggle } from '../../ui/Toggle';
import { Button } from '../../ui/Button';
import { StatusChip } from '../../ui/StatusChip';
import { cn, inputClass, inputErrorClass } from '../../../utils/styles';

// The plain controls of the guided setup, and the same controls at the top of the agent's own pages, so a later change
// is the same move as the first time. Each change is an ordinary edit of the draft (Save keeps it, Undo takes it back),
// made through models/setup.ts, which writes only the server's real config paths.

interface BlockProps {
  editor: DraftEditor;
}

function Row({ title, text, children, aside }: { title: string; text?: string; children?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{title}</p>
          {text && <p className="mt-0.5 text-[13px] text-muted">{text}</p>}
        </div>
        {aside}
      </div>
      {children}
    </div>);

}

/** What it does: the instructions of the agent that answers, and what it says first. */
export function PurposeBlock({ editor }: BlockProps) {
  const config = editor.config;
  if (!config) return null;
  const i = entryIndex(config);
  const role = i >= 0 ? String(config.agents?.items?.[i]?.instructions?.role ?? '') : '';
  const greetingAt = (config.channels ?? []).findIndex((c) => c.enabled && typeof c.greeting?.say === 'string');
  const greeting = greetingAt >= 0 ? String(config.channels?.[greetingAt]?.greeting?.say ?? '') : '';
  const fromStarter = isStarterRole(role, starters);
  const setGreeting = (text: string) => {
    // Every channel that says a line of its own text says the new one (a channel saying a fixed line keeps it).
    const next = (config.channels ?? []).map((c) => (c.enabled && (c.greeting?.say === undefined || typeof c.greeting?.say === 'string') ? { ...c, greeting: { ...c.greeting, say: text } } : c));
    editor.update(['channels'], next);
  };
  return (
    <div className="space-y-5">
      {i < 0 ?
      <p className="text-sm text-muted">This agent has no agent to give instructions to yet. Add one in the JSON view.</p> :

      <label className="block">
          <span className="text-sm font-medium text-ink">What it should do</span>
          <span className="mt-0.5 block text-[13px] text-muted">Who it helps, what it does, and what it must never do. Plain words work best.</span>
          <textarea
          rows={6}
          className={cn(inputClass, 'mt-2 resize-y leading-relaxed')}
          value={role}
          disabled={!editor.canEdit}
          onChange={(e) => editor.update(['agents', 'items', i, 'instructions', 'role'], e.target.value)} />
          {fromStarter &&
        <span className="mt-1.5 block rounded-md bg-warning-soft px-3 py-2 text-[13px] text-ink-soft">
              These are the starter’s own words. Make them your business’s: who you are, what you offer, and anything it must not do.
            </span>
        }
        </label>
      }
      <label className="block">
        <span className="text-sm font-medium text-ink">What it says first</span>
        <input className={cn(inputClass, 'mt-2')} value={greeting} disabled={!editor.canEdit || !(config.channels ?? []).some((c) => c.enabled)} onChange={(e) => setGreeting(e.target.value)} placeholder="Hi! How can I help you today?" />
        {greetingAt < 0 && (config.channels ?? []).some((c) => c.enabled) && <span className="mt-1 block text-[13px] text-muted">Its channels say a fixed line from the messages; change it in the JSON view.</span>}
      </label>
    </div>);

}

/** Where people reach it: web chat, talking on the website, phone calls. */
export function ReachBlock({ editor }: BlockProps) {
  const { answer: providers } = useProviders();
  const [note, setNote] = useState<{ tone: 'info' | 'warning'; text: string } | null>(null);
  const config = editor.config;
  if (!config) return null;
  const on = reachOf(config);
  const flip = (type: (typeof REACH)[number]['type'], value: boolean) => {
    const r = setReach(config, type, value, { providers, botId: editor.agent?.id });
    if (r.refused) {
      setNote({ tone: 'warning', text: r.refused });
      return;
    }
    editor.replaceConfig(r.config);
    setNote(r.added.length ? { tone: 'info', text: `Switched on, with ${r.added.join(', ')}. Nothing is saved until you press Save.` } : null);
  };
  return (
    <div className="space-y-2">
      {REACH.map((r) =>
      <Row key={r.type} title={r.label} text={r.text} aside={<Toggle checked={on[r.type]} onChange={(v) => flip(r.type, v)} label={r.label} disabled={!editor.canEdit} />} />
      )}
      {note && <p role="status" className={cn('rounded-md px-3 py-2 text-[13px]', note.tone === 'warning' ? 'bg-warning-soft text-ink' : 'bg-info-soft text-ink-soft')}>{note.text}</p>}
    </div>);

}

/** Language and voice: the main language, and (when people talk to it) a voice that speaks it. */
export function LanguageVoiceBlock({ editor }: BlockProps) {
  const { answer: providers, error } = useProviders();
  const config = editor.config;
  if (!config) return null;
  const language = config.defaults?.language?.primary ?? '';
  const voiceOn = reachOf(config).web_voice || reachOf(config).sip_voice;
  const tts = config.defaults?.models?.tts;
  const ttsProviders = providersFor('tts', providers, tts?.provider);
  const voices = voicesFor(tts?.provider, language);
  const setProvider = (p: string) => {
    let next: AgentConfig = putAt(config, ['defaults', 'models', 'tts', 'provider'], p);
    providerFollowUps['defaults.models.tts.provider'].apply(p, (path, value) => (next = putAt(next, path, value)));
    const first = voicesFor(p, language)[0];
    if (first) next = putAt(next, ['defaults', 'models', 'tts', 'voice_id'], first.voiceId);
    editor.replaceConfig(next);
  };
  return (
    <div className="space-y-5">
      <label className="block">
        <span className="text-sm font-medium text-ink">Main language</span>
        <select className={cn(inputClass, 'mt-2 max-w-sm')} value={language} disabled={!editor.canEdit} onChange={(e) => editor.replaceConfig(setPrimaryLanguage(config, e.target.value))}>
          {!language && <option value="">Not set: the server’s default</option>}
          {language && !LANGUAGES.some(([c]) => c === language) && <option value={language}>{languageName(language)}</option>}
          {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      {!voiceOn ?
      <p className="text-[13px] text-muted">People only type to it, so it needs no voice. Switch on talking on the website or phone calls to choose one.</p> :

      <div>
          <p className="text-sm font-medium text-ink">Voice</p>
          {error && <p className="mt-1 text-[13px] text-warning">The provider list could not be loaded ({error}).</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {ttsProviders.map((p) =>
          <button
            key={p.value}
            type="button"
            aria-pressed={tts?.provider === p.value}
            disabled={!editor.canEdit}
            onClick={() => setProvider(p.value)}
            className={cn('rounded-md border px-3 py-1.5 text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40', tts?.provider === p.value ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-soft hover:border-line-strong')}>
                {p.label}{p.keyAvailable === false ? ' (key not set on the server)' : ''}
              </button>
          )}
          </div>
          {tts?.provider && voices.length === 0 &&
        <p className="mt-3 text-[13px] text-muted">No voices that speak {languageName(language) || 'this language'} are listed for {tts.provider}. Type a voice id in Build › Agent, or pick another provider.</p>
        }
          <div role="radiogroup" aria-label="Voice" className="mt-3 grid gap-2 sm:grid-cols-3">
            {voices.map((v) =>
          <button
            key={v.voiceId}
            type="button"
            role="radio"
            aria-checked={tts?.voice_id === v.voiceId}
            disabled={!editor.canEdit}
            onClick={() => editor.update(['defaults', 'models', 'tts', 'voice_id'], v.voiceId)}
            title={`Voice id: ${v.voiceId}`}
            className={cn('rounded-lg border px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40', tts?.voice_id === v.voiceId ? 'border-accent bg-accent-soft/60 ring-1 ring-accent' : 'border-line hover:border-line-strong')}>
                <span className="block text-sm font-medium text-ink">{v.name}</span>
                <span className="block text-xs text-muted">{v.style} · {v.language}</span>
              </button>
          )}
          </div>
        </div>
      }
    </div>);

}

const READING_WORDS: Record<KnowledgeReading, string> = {
  ready: 'Read, and ready to answer from',
  reading: 'Being read…',
  unread: 'Not read yet',
  changed: 'Changed since it was read',
  failed: 'Reading failed',
  unknown: 'Not known',
};

/** What it knows: documents and web pages in one base the agent that answers reads, and reading them. */
export function KnowledgeBlock({ editor }: BlockProps) {
  useSyncExternalStore(subscribeFacts, factsVersion, factsVersion);
  const agentId = editor.agent?.id ?? '';
  const fileRef = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState('');
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState<'upload' | 'build' | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  useEffect(() => {
    if (agentId) void loadFacts(agentId);
  }, [agentId]);
  const config = editor.config;
  if (!config) return null;
  const k = knowledgeOf(config);
  const base = getFacts(agentId)?.knowledge?.find((b) => b.id === KNOWLEDGE_ID);
  const reading = k.files.length || k.pages.length ? readingOf(base) : null;

  const upload = async (file: File) => {
    setBusy('upload');
    setMessage(null);
    try {
      await api.uploadKnowledgeFile(agentId, file.name, file);
      editor.replaceConfig(addKnowledgeFile(config, file.name));
      setMessage({ tone: 'info', text: `${file.name} is uploaded. Save, then read the documents so it can answer from them.` });
    } catch (err: unknown) {
      setMessage({ tone: 'error', text: `${file.name} was not uploaded: ${err instanceof Error ? err.message : 'the server refused it'}` });
    } finally {
      setBusy(null);
    }
  };
  const addPage = () => {
    const url = cleanUrl(page);
    if (!url) {
      setMessage({ tone: 'error', text: 'Type a web address, for example example.com/help.' });
      return;
    }
    editor.replaceConfig(addKnowledgePage(config, url, { linked }));
    setPage('');
    setMessage(null);
  };
  const remove = (kind: 'file' | 'url', value: string) => {
    const r = removeKnowledge(config, kind, value);
    if (r.refused) setMessage({ tone: 'error', text: r.refused });
    else editor.replaceConfig(r.config);
  };
  const read = async () => {
    // The server reads what is saved: unsaved edits are saved first.
    if (!(await editor.ensureSaved('Reading the documents'))) return;
    setBusy('build');
    setMessage(null);
    try {
      await api.buildKnowledge(agentId, KNOWLEDGE_ID);
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const s = await api.knowledgeStatus(agentId, KNOWLEDGE_ID);
        if (s.build?.status !== 'running' && s.build?.status !== 'pending') {
          const failed = s.build?.status === 'failed';
          const why = (s.build as { error?: string } | undefined)?.error;
          setMessage(failed ? { tone: 'error', text: `Reading failed: ${why ?? 'the server did not say why'}` } : { tone: 'info', text: 'Read. It can answer from these now.' });
          break;
        }
      }
    } catch (err: unknown) {
      setMessage({ tone: 'error', text: `The server did not read them: ${err instanceof Error ? err.message : 'unknown error'}` });
    } finally {
      setBusy(null);
      void loadFacts(agentId, { force: true });
    }
  };

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {k.files.map((f) =>
        <li key={f} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-ink"><FileTextIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden /><span className="truncate">{f}</span></span>
            <Button size="sm" variant="ghost" onClick={() => remove('file', f)} disabled={!editor.canEdit} aria-label={`Stop using ${f}`}><Trash2Icon className="h-3.5 w-3.5" aria-hidden /></Button>
          </li>
        )}
        {k.pages.map((p) =>
        <li key={p} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-ink">
              <GlobeIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span className="truncate">{p}</span>
              {k.depths[p] ? <span className="shrink-0 text-xs text-muted">and the pages it links to</span> : null}
            </span>
            <Button size="sm" variant="ghost" onClick={() => remove('url', p)} disabled={!editor.canEdit} aria-label={`Stop using ${p}`}><Trash2Icon className="h-3.5 w-3.5" aria-hidden /></Button>
          </li>
        )}
        {!k.files.length && !k.pages.length && <li className="px-4 py-6 text-center text-[13px] text-muted">No documents or web pages yet. Add some below.</li>}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.html,.htm,.pdf,.csv,.json" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = '';
        }} />
        <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={!editor.canEdit || busy !== null}>
          {busy === 'upload' ? <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <UploadIcon className="h-3.5 w-3.5" aria-hidden />}
          Upload a document
        </Button>
        <span className="text-xs text-muted">Text, Markdown, HTML, PDF, CSV or JSON. It is uploaded to the server straight away.</span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[240px] flex-1">
          <span className="text-[13px] font-medium text-ink-soft">A web page</span>
          <input className={cn(inputClass, 'mt-1', message?.tone === 'error' && page && !cleanUrl(page) && inputErrorClass)} value={page} onChange={(e) => setPage(e.target.value)} placeholder="example.com/help" disabled={!editor.canEdit} onKeyDown={(e) => e.key === 'Enter' && addPage()} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-[13px] text-ink-soft">
          <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} disabled={!editor.canEdit} />
          Also the pages it links to
        </label>
        <Button size="sm" variant="secondary" onClick={addPage} disabled={!editor.canEdit || !page.trim()}>Add page</Button>
      </div>

      {(k.files.length > 0 || k.pages.length > 0) &&
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-subtle px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] text-ink-soft">
            {reading && <StatusChip tone={reading === 'ready' ? 'success' : reading === 'failed' ? 'danger' : 'warning'} dot>{READING_WORDS[reading]}</StatusChip>}
            It answers from these once the server has read them.
          </span>
          <Button size="sm" variant="primary" onClick={() => void read()} disabled={!editor.canEdit || busy !== null}>
            {busy === 'build' ? <><LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" aria-hidden />Reading…</> : 'Read them now'}
          </Button>
        </div>
      }
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={cn('rounded-md px-3 py-2 text-[13px]', message.tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-info-soft text-ink-soft')}>{message.text}</p>}
    </div>);

}

/** What it can do: end the conversation, pass to a person, take contact details, look something up. */
export function ActionsBlock({ editor }: BlockProps) {
  const config = editor.config;
  const state = config ? actionsOf(config) : null;
  const [number, setNumber] = useState(state?.hand_over.number ?? '');
  const [lookup, setLookupForm] = useState({ url: state?.lookup.url ?? '', finds: state?.lookup.finds ?? '', needs: state?.lookup.needs ?? '' });
  const [problem, setProblem] = useState('');
  useEffect(() => {
    if (state) setNumber(state.hand_over.number);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.hand_over.number]);
  if (!config || !state) return null;

  const flip = (id: ActionId, on: boolean) => {
    setProblem('');
    if (id === 'end_call') editor.replaceConfig(setEndCall(config, on));
    if (id === 'hand_over') editor.replaceConfig(setHandOver(config, on, on ? { number } : {}));
    if (id === 'details') editor.replaceConfig(setDetails(config, on));
    if (id === 'lookup') {
      if (!on) editor.replaceConfig(setLookup(config, false).config);
      else {
        const r = setLookup(config, true, lookup);
        if (r.problem) setProblem(r.problem);
        else editor.replaceConfig(r.config);
      }
    }
  };

  return (
    <div className="space-y-2">
      {ACTIONS.map((a) => {
        const on = state[a.id].on;
        return (
          <Row key={a.id} title={a.label} text={a.text} aside={<Toggle checked={on} onChange={(v) => flip(a.id, v)} label={a.label} disabled={!editor.canEdit} />}>
            {a.id === 'hand_over' && on &&
            <label className="mt-3 block">
                <span className="text-[13px] font-medium text-ink-soft">Number to pass calls to</span>
                <input
                className={cn(inputClass, 'mt-1 max-w-xs', numberProblem(number) && inputErrorClass)}
                value={number}
                placeholder="+65 6123 4567"
                disabled={!editor.canEdit}
                onChange={(e) => setNumber(e.target.value)}
                onBlur={() => !numberProblem(number) && number !== state.hand_over.number && editor.replaceConfig(setHandOver(config, true, { number }))} />
                <span className={cn('mt-1 block text-[13px]', numberProblem(number) ? 'text-danger' : 'text-muted')}>
                  {numberProblem(number) || (number ? 'Phone calls are passed to this number.' : 'Without a number it says the callback line instead.')}
                </span>
              </label>
            }
            {a.id === 'details' && on &&
            <fieldset className="mt-3 flex flex-wrap gap-4">
                <legend className="sr-only">Details it asks for</legend>
                {DETAIL_FIELDS.map((f) =>
              <label key={f.name} className="flex items-center gap-2 text-[13px] text-ink-soft">
                    <input
                  type="checkbox"
                  checked={state.details.fields.includes(f.name)}
                  disabled={!editor.canEdit || (state.details.fields.length === 1 && state.details.fields.includes(f.name))}
                  onChange={(e) => editor.replaceConfig(setDetails(config, true, { fields: e.target.checked ? [...state.details.fields, f.name] : state.details.fields.filter((x) => x !== f.name) }))} />
                    {f.label}
                  </label>
              )}
              </fieldset>
            }
            {a.id === 'lookup' &&
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {(['url', 'finds', 'needs'] as const).map((key) =>
              <label key={key} className={cn('block', key === 'url' && 'sm:col-span-3')}>
                    <span className="text-[13px] font-medium text-ink-soft">{key === 'url' ? 'Web address (the person’s answer in {curly brackets})' : key === 'finds' ? 'What it finds' : 'What it needs from the person'}</span>
                    <input
                  className={cn(inputClass, 'mt-1')}
                  value={lookup[key]}
                  placeholder={key === 'url' ? 'https://shop.example.com/orders/{order number}' : key === 'finds' ? 'an order' : 'order number'}
                  disabled={!editor.canEdit}
                  onChange={(e) => setLookupForm({ ...lookup, [key]: e.target.value })} />
                  </label>
              )}
                {on && <div className="sm:col-span-3"><Button size="sm" variant="secondary" onClick={() => flip('lookup', true)} disabled={!editor.canEdit}>Use these</Button></div>}
              </div>
            }
          </Row>);

      })}
      {problem && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{problem}</p>}
    </div>);

}
