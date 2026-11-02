import React, { useEffect, useSyncExternalStore } from 'react';
import { ArrowRightIcon, XIcon } from 'lucide-react';
import type { DraftEditor } from '../../../hooks/useDraftEditor';
import type { SettingGroupId } from '../../../data/settingsCatalog';
import type { Path } from '../../../types/studio';
import { GuidedSection } from './GuidedSection';
import { ChannelsEditor } from './ChannelsEditor';
import { toolLabel } from './toolTypes';
import { Field } from '../../ui/Field';
import { Toggle } from '../../ui/Toggle';
import { Segmented } from '../../ui/Segmented';
import { StatusChip } from '../../ui/StatusChip';
import { llmProviders } from '../../../data/providers';
import { VOICE_CATALOG } from '../../../data/voiceCatalog';
import { useProviders } from '../../../hooks/useProviders';
import { providersFor, voicesFor } from '../../../utils/providerOptions';
import { fieldId } from '../../../utils/path';
import { getInstructionsText, issuesAt } from '../../../utils/validate';
import { missingProviderKey, providerFollowUps } from '../../../utils/settingOptions';
import { settingsCatalog } from '../../../data/settingsCatalog';
import { SettingField } from './SettingField';
import { ActionsBlock, KnowledgeBlock, LanguageVoiceBlock, PurposeBlock, ReachBlock } from '../setup/SimpleBlocks';
import { Button } from '../../ui/Button';
import { buildSections, type GuidedPartId } from '../../../models/buildSections';
import type { BuildSection } from '../../../models/agentPages';
import { factsVersion, getFacts, loadFacts, subscribeFacts } from '../../../utils/agentFacts';
import { cn, inputClass, inputErrorClass } from '../../../utils/styles';

/** The plain-language parts this view can show; a Build section shows the ones that belong to it. */
export type GuidedPart = 'personality' | 'voice' | 'model' | 'tools' | 'channels' | 'records';

interface GuidedViewProps {
  parts?: GuidedPart[];
  editor: DraftEditor;
  onMore: (group: SettingGroupId) => void;
}


export function GuidedView({ editor, onMore, parts }: GuidedViewProps) {
  const show = (part: GuidedPart) => !parts || parts.includes(part);
  const { config, update, canEdit } = editor;
  // Field problems come from the server's report (none shown until it has answered).
  const validation = { errors: editor.validation?.errors ?? [], warnings: editor.validation?.warnings ?? [] };
  const { answer: providers, error: providersError } = useProviders();
  if (!config) return null;
  const disabled = !canEdit;
  const err = (p: Path) => issuesAt(validation.errors, p)[0]?.message;
  const warn = (p: Path) => issuesAt(validation.warnings, p)[0]?.message;

  const entryIndex = Math.max(0, (config.agents?.items ?? []).findIndex((a) => a.id === config.agents?.entry));
  const entry = config.agents?.items?.[entryIndex];
  const toolsPath: Path = ['agents', 'items', entryIndex, 'tools'];
  const declared = config.tools ?? [];
  const undeclared = (entry?.tools ?? []).filter((t) => !declared.some((d) => d.id === t));

  const llmProviderId = config.defaults?.models?.llm?.provider;
  const ttsProviderId = config.defaults?.models?.tts?.provider;
  const currentVoice = config.defaults?.models?.tts?.voice_id;
  const llmModels = llmProviders.find((p) => p.id === llmProviderId)?.models ?? [];
  const voices = voicesFor(ttsProviderId, VOICE_CATALOG);
  const providerChoices = (stage: 'llm' | 'tts', current: string | undefined) =>
  providersFor(stage, providers, current).map((p) => ({ value: p.value, label: p.unlisted ? `${p.label} (not reported)` : p.label }));
  const listNote = providersError ? `The provider list could not be loaded (${providersError}); only the current choice is shown.` : undefined;
  const llmMissing = missingProviderKey('defaults.models.llm.provider', llmProviderId ?? '', providers);
  const ttsMissing = missingProviderKey('defaults.models.tts.provider', ttsProviderId ?? '', providers);

  const setProvider = (kind: 'llm' | 'tts', id: string) => {
    update(['defaults', 'models', kind, 'provider'], id);
    providerFollowUps[`defaults.models.${kind}.provider`].apply(id, update);
  };
  const setting = (path: string) => {
    const def = settingsCatalog.find((s) => s.path === path);
    return def ? <SettingField key={path} def={def} config={config} errors={validation.errors} warnings={validation.warnings} technical={false} disabled={disabled} update={update} /> : null;
  };

  return (
    <div>
      {show('personality') &&
      <GuidedSection id="g-personality" title="Personality and instructions" description="Who the agent is and what it should do. This shapes every reply." onMore={() => onMore('about')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={fieldId('persona.company')} label="Company name" error={err(['persona', 'company'])}>
            <input id={`${fieldId('persona.company')}-input`} className={cn(inputClass, err(['persona', 'company']) && inputErrorClass)} value={config.persona?.company ?? ''} disabled={disabled} onChange={(e) => update(['persona', 'company'], e.target.value)} />
          </Field>
          <Field id={fieldId('persona.name')} label="Agent’s spoken name" help="What it calls itself.">
            <input id={`${fieldId('persona.name')}-input`} className={inputClass} value={config.persona?.name ?? ''} disabled={disabled} onChange={(e) => update(['persona', 'name'], e.target.value)} />
          </Field>
        </div>
        {setting('persona.tone')}
        {entry &&
        <Field
          id={fieldId(['agents', 'items', entryIndex, 'instructions'])}
          label="Instructions"
          help="Plain language works best. Say what to help with, what to never do, and when to hand over."
          warning={warn(['agents', 'items', entryIndex, 'instructions'])}>
          
            <textarea
            id={`${fieldId(['agents', 'items', entryIndex, 'instructions'])}-input`}
            rows={5}
            className={cn(inputClass, 'resize-y leading-relaxed')}
            value={getInstructionsText(entry.instructions)}
            disabled={disabled}
            onChange={(e) => {
              const val = e.target.value;
              if (typeof entry.instructions === 'object' && entry.instructions !== null) {
                update(['agents', 'items', entryIndex, 'instructions'], { ...entry.instructions, role: val });
              } else {
                update(['agents', 'items', entryIndex, 'instructions'], { role: val });
              }
            }}
            placeholder="Help callers with bills and payments. Look up the account before answering anything specific." />
          
          </Field>
        }
      </GuidedSection>
      }

      {show('voice') &&
      <GuidedSection id="g-voice" title="Voice and language" description="What callers hear on web voice and phone." onMore={() => onMore('talks')}>
        {setting('defaults.language.primary')}
        {(config.defaults?.language?.speaks?.length || config.defaults?.language?.auto_detect) &&
        <div className="-mt-3 mb-5 flex flex-wrap items-center gap-2 text-xs text-muted">
            {!!config.defaults?.language?.speaks?.length &&
          <span className="inline-flex items-center gap-1 rounded border border-line bg-surface px-2 py-0.5">
                Answers in: <strong className="font-medium text-ink">{config.defaults.language.speaks.join(', ')}</strong>
              </span>
          }
            {config.defaults?.language?.auto_detect &&
          <span className="inline-flex items-center rounded bg-accent/10 px-2 py-0.5 font-medium text-accent">Detects the caller’s language</span>
          }
          </div>
        }
        <Field
          id={fieldId('defaults.models.tts.voice_id')}
          label="Voice"
          error={err(['defaults', 'models', 'tts'])}
          warning={ttsMissing ? `The server doesn’t have ${ttsMissing} yet. Voice calls will fail until an admin adds it.` : listNote}>
          
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[13px] text-muted">Provider</span>
            <Segmented size="sm" label="Voice provider" options={providerChoices('tts', ttsProviderId)} value={ttsProviderId ?? ''} onChange={(v) => !disabled && setProvider('tts', v)} />
          </div>
          {voices.length === 0 ?
          <div>
              <p className="mb-1.5 text-[13px] text-muted">No voices are listed for this provider here. Enter the provider’s voice id.</p>
              <input
              id={`${fieldId('defaults.models.tts.voice_id')}-input`}
              className={cn(inputClass, 'max-w-sm font-mono')}
              value={currentVoice ?? ''}
              disabled={disabled}
              spellCheck={false}
              onChange={(e) => update(['defaults', 'models', 'tts', 'voice_id'], e.target.value === '' ? undefined : e.target.value)} />

            </div> :

          <div role="radiogroup" aria-label="Voice" className="grid gap-2 sm:grid-cols-3">
            {voices.map((v, i) => {
              const active = currentVoice === v.voiceId;
              return (
                <button
                  key={v.voiceId}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  title={`Voice id: ${v.voiceId}`}
                  id={i === 0 ? `${fieldId('defaults.models.tts.voice_id')}-input` : undefined}
                  onClick={() => update(['defaults', 'models', 'tts', 'voice_id'], v.voiceId)}
                  className={cn(
                    'rounded-lg border px-3 py-2.5 text-left transition-[border-color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    active ? 'border-accent bg-accent-soft/60 ring-1 ring-accent' : 'border-line hover:border-line-strong'
                  )}>

                  <span className="block text-sm font-medium text-ink">{v.name}</span>
                  <span className="block text-xs text-muted">{v.style} · {v.language}</span>
                </button>);

            })}
          </div>
          }
          {voices.length > 0 && currentVoice && !voices.some((v) => v.voiceId === currentVoice) &&
          <p className="mt-2 text-xs text-muted">Current voice id <span className="font-mono">{currentVoice}</span> is not in this list; it is kept until you pick another.</p>
          }
        </Field>
      </GuidedSection>
      }

      {show('model') &&
      <GuidedSection id="g-model" title="AI model" description="The model that decides what to say. Bigger is smarter, slower and costs more." onMore={() => onMore('behaves')}>
        <Field
          id={fieldId('defaults.models.llm.model')}
          label="Model"
          recommended="GPT-4.1 mini"
          error={err(['defaults', 'models', 'llm'])}
          warning={llmMissing ? `The server doesn’t have ${llmMissing} yet. Tests and calls will fail until an admin adds it.` : listNote}>
          
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[13px] text-muted">Provider</span>
            <Segmented size="sm" label="Model provider" options={providerChoices('llm', llmProviderId)} value={llmProviderId ?? ''} onChange={(v) => !disabled && setProvider('llm', v)} />
          </div>
          {llmModels.length === 0 &&
          <div>
              <p className="mb-1.5 text-[13px] text-muted">No models are suggested for this provider here. Enter the model name the provider uses.</p>
              <input
              id={`${fieldId('defaults.models.llm.model')}-input`}
              className={cn(inputClass, 'max-w-sm font-mono')}
              value={config.defaults?.models?.llm?.model ?? ''}
              disabled={disabled}
              spellCheck={false}
              onChange={(e) => update(['defaults', 'models', 'llm', 'model'], e.target.value)} />

            </div>
          }
          <div role="radiogroup" aria-label="Model" className={cn('divide-y divide-line rounded-lg border border-line', llmModels.length === 0 && 'hidden')}>
            {llmModels.map((m, i) => {
              const active = config.defaults?.models?.llm?.model === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  id={i === 0 ? `${fieldId('defaults.models.llm.model')}-input` : undefined}
                  onClick={() => update(['defaults', 'models', 'llm', 'model'], m.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40">
                  
                  <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', active ? 'border-accent' : 'border-line-strong')} aria-hidden>
                    {active && <span className="h-2 w-2 rounded-full bg-accent" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{m.label}</span>
                    <span className="block text-xs text-muted">{m.note}</span>
                  </span>
                </button>);

            })}
          </div>
        </Field>
      </GuidedSection>
      }

      {show('tools') &&
      <GuidedSection id="g-tools" title="What it can do" description={`Actions ${entry?.name ?? 'the agent'} can take during a conversation.`} onMore={() => onMore('can_do')}>
        <div id={fieldId(toolsPath)} className="scroll-mt-28 rounded-md transition-[box-shadow] duration-200">
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {declared.map((tool) => {
              const on = (entry?.tools ?? []).includes(tool.id);
              return (
                <li key={tool.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                      {tool.description}
                      {tool.type === 'mcp' && <StatusChip tone="warning">Not available yet</StatusChip>}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {toolLabel(tool)} · <code className="font-mono">{tool.id}</code>
                    </p>
                  </div>
                  <Toggle
                    checked={on}
                    disabled={disabled}
                    label={`${entry?.name} can use ${tool.id}`}
                    onChange={(v) => update(toolsPath, v ? [...(entry?.tools ?? []), tool.id] : (entry?.tools ?? []).filter((t) => t !== tool.id))} />
                  
                </li>);

            })}
            {undeclared.map((t) =>
            <li key={t} className="flex items-start justify-between gap-4 bg-danger-soft/50 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-danger">
                    <code className="font-mono">{t}</code> is used but doesn’t exist
                  </p>
                  <p className="mt-0.5 text-xs text-ink-soft">Remove it, or declare the tool in the JSON view.</p>
                </div>
                <button
                type="button"
                disabled={disabled}
                onClick={() => update(toolsPath, (entry?.tools ?? []).filter((x) => x !== t))}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-danger transition-colors duration-150 hover:bg-danger/10">
                
                  <XIcon className="h-3.5 w-3.5" aria-hidden />
                  Remove
                </button>
              </li>
            )}
          </ul>
        </div>
      </GuidedSection>
      }

      {show('channels') &&
      <GuidedSection id="g-channels" title="Where it is available" description="Turn on the places people can reach this agent, each with its own greeting." onMore={() => onMore('available')}>
        <ChannelsEditor config={config} errors={validation.errors} disabled={disabled} update={update} />
      </GuidedSection>
      }

      {show('records') &&
      <GuidedSection id="g-records" title="Call records" description="What’s kept after each conversation. Transcripts may contain personal data." onMore={() => onMore('after')}>
        <div className="space-y-4">
          {['observability.session_log.enabled', 'post_call.recording.transcript', 'post_call.recording.audio', 'persona.disclosures.recording_notice', 'observability.session_log.retention_days'].map(setting)}
        </div>
      </GuidedSection>
      }
    </div>);

}

// ---- Build on one page ----------------------------------------------------------------------------------------------
/** The parts in build order: a part with plain controls shows them; one without says what its page is for. */
const GUIDED: { id: GuidedPartId; title: string; open?: string; more?: string }[] = [
  { id: 'agent', title: 'Who it is and how it sounds' },
  { id: 'knowledge', title: 'What it knows' },
  { id: 'tools', title: 'What it can do' },
  {
    id: 'workflow',
    title: 'How a conversation moves',
    open: 'Open the Workflow',
    more: 'See who answers first, add more agents, and choose when one hands a conversation to another, all on one picture.',
  },
  { id: 'channels', title: 'Where people reach it' },
  {
    id: 'guardrails',
    title: 'Its boundaries',
    open: 'Set its boundaries',
    more: 'Choose the topics it keeps to or stays away from, when it passes someone to your team, and when it ends a call.',
  },
  {
    id: 'aftercall',
    title: 'After the call',
    open: 'Choose what happens',
    more: 'Have it write a summary of every call, answer your own questions about each one, and choose what is kept and for how long.',
  },
];

interface GuidedBuildProps {
  editor: DraftEditor;
  /** Server problems per Build section (models/agentPages problemsBySection). */
  problems: Partial<Record<BuildSection, number>>;
  onOpenSection: (section: BuildSection) => void;
  onOpenWorkflow: () => void;
}

/**
 * Build on one page: every part of the agent in build order, each with its plain controls (the same ones the guided
 * setup uses), where it stands, and a link to its own page with all its settings. The checks sit beside it.
 */
export function GuidedBuild({ editor, problems, onOpenSection, onOpenWorkflow }: GuidedBuildProps) {
  useSyncExternalStore(subscribeFacts, factsVersion, factsVersion);
  const agentId = editor.agent?.id ?? '';
  useEffect(() => {
    if (agentId) void loadFacts(agentId);
  }, [agentId]);
  const config = editor.config;
  if (!config) return null;
  const rows = buildSections({ config, errorsBySection: problems, knowledgeRead: getFacts(agentId)?.knowledge ?? null });
  const open = (id: GuidedPartId) => (id === 'workflow' ? onOpenWorkflow() : onOpenSection(id));

  const controls = (id: GuidedPartId) => {
    switch (id) {
      case 'agent':
        return (
          <>
            <PurposeBlock editor={editor} />
            <LanguageVoiceBlock editor={editor} />
          </>);
      case 'knowledge':
        return <KnowledgeBlock editor={editor} />;
      case 'tools':
        return <ActionsBlock editor={editor} />;
      case 'channels':
        return <ReachBlock editor={editor} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-w-0" data-guided-build>
      {GUIDED.map((g) => {
        const row = rows.find((r) => r.id === g.id);
        const own = !g.open;
        return (
          <GuidedSection
            key={g.id}
            id={`one-${g.id}`}
            title={g.title}
            description={row?.purpose ?? ''}
            status={row ? { state: row.state, text: row.status } : null}
            onMore={own ? () => open(g.id) : undefined}
            moreLabel="Open its page">
            {own ?
            controls(g.id) :

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-surface p-5">
                <p className="max-w-[520px] text-[13px] leading-relaxed text-ink-soft">{g.more}</p>
                <Button size="sm" variant="secondary" onClick={() => open(g.id)}>
                  {g.open}
                  <ArrowRightIcon className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            }
          </GuidedSection>);

      })}
    </div>);

}
