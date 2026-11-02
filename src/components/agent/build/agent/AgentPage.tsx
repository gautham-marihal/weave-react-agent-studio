import React, { useMemo, useRef, useState } from 'react';
import { type LucideIcon, AudioLinesIcon, ChevronRightIcon, CpuIcon, GlobeIcon, PlusIcon, QuoteIcon, UserRoundIcon, XIcon } from 'lucide-react';
import type { AgentConfig, Issue, Path } from '../../../../types/studio';
import type { DraftEditor } from '../../../../hooks/useDraftEditor';
import type { Readiness } from '../../../../models/readiness';
import { openStepsOn } from '../../../../models/readiness';
import { useProviders } from '../../../../hooks/useProviders';
import { providerLabel } from '../../../../data/providers';
import { languageName } from '../../../../models/languages';
import { templateScope } from '../../../../models/templates';
import { entryAgentIndex, greetingHint, greetingOf, greetingTarget, inWords, readAgentPage, readDataFlow, setAgentName, setGreeting, setPersona, setRole, shareGreeting, staleNameParts, staleSentence, type GreetingPlace } from '../../../../models/agentPage';
import { readLanguages, spokenChips, voiceInUse } from '../../../../models/pickers';
import { readModels, slotProblem, summarizeModels } from '../../../../models/pickersModels';
import { fieldId } from '../../../../utils/path';
import { cn, inputClass, inputErrorClass } from '../../../../utils/styles';
import { StatusChip } from '../../../ui/StatusChip';
import { TemplateField } from './TemplateField';
import { InlinePromptPreview } from './PromptPreview';
import { SidePanel } from './SidePanel';
import { VoicePicker } from '../pickers/VoicePicker';
import { LanguagePicker } from '../pickers/LanguagePicker';
import { ModelPicker } from '../pickers/ModelPicker';

type PanelId = 'voice' | 'language' | 'models' | 'behaviour' | 'persona';

const startsWith = (path: Path | null, ...head: Array<string | number>) => !!path && head.every((h, i) => path[i] === h);

/**
 * The Agent page: its name, what the agent that answers first should do, what it says first on every channel, and the
 * choices that make it sound like itself. A choice is a row that opens a panel on one topic; only "Done" puts the
 * panel's changes into the draft. Everything is an ordinary edit of the draft (Save keeps it, Undo takes it back).
 */
export function AgentPage({ editor, readiness }: { editor: DraftEditor; readiness?: Readiness | null }) {
  const config = editor.config;
  const disabled = !editor.canEdit;
  const [open, setOpen] = useState<PanelId | null>(null);
  // the channels the greeting writes to, fixed at its first change this visit, so emptying and retyping keeps them and
  // a channel with its own greeting is never overwritten
  const [greetingFor, setGreetingFor] = useState<GreetingPlace[] | null>(null);
  // after a rename: the old and new name, while places still say the old one
  const nameAtFocus = useRef('');
  const [renamed, setRenamed] = useState<{ from: string; to: string } | null>(null);
  const { answer: providersAnswer, error: providersError } = useProviders();
  const providers = providersAnswer?.providers ?? null;
  const scope = useMemo(() => templateScope(config), [config]);

  if (!config) return null;
  const set = (next: AgentConfig) => {
    if (next !== config) editor.replaceConfig(next);
  };
  const read = readAgentPage(config);
  const entry = entryAgentIndex(config);
  const greeting = greetingOf(config, greetingFor);
  const firstGreeting = Math.max(0, (config.channels ?? []).findIndex((c) => c?.enabled));
  const languages = readLanguages(config);
  const models = readModels(config);
  const flow = readDataFlow(config);

  // the server's problems, by where they are
  const errors: Issue[] = editor.validation?.errors ?? [];
  const count = (match: (p: Path | null) => boolean) => errors.filter((e) => match(e.path)).length;
  const first = (match: (p: Path | null) => boolean) => errors.find((e) => match(e.path))?.message ?? '';
  const nameError = first((p) => startsWith(p, 'meta', 'name')) ? 'Give it a name: it is how you find it in your list of agents.' : '';
  const roleIssue = first((p) => startsWith(p, 'agents', 'items', entry, 'instructions'));
  const roleError = roleIssue ? (/required|empty|at least/i.test(roleIssue) ? 'Say what it should do: it can’t answer anyone without this.' : roleIssue) : '';
  const greetingError = first((p) => startsWith(p, 'channels') && p?.[2] === 'greeting');
  // readiness steps on this page still to do: their row says "To do" (a problem to fix says so instead)
  const todo = new Set(readiness ? openStepsOn(readiness, (t) => t.stage === 'build' && t.section === 'agent').map((s) => s.target.focus) : []);
  const status = (problems: number, focus?: string): { tone: 'danger' | 'warning'; text: string } | null =>
  problems ? { tone: 'danger', text: `${problems} to fix` } : focus && todo.has(focus) ? { tone: 'warning', text: 'To do' } : null;

  // what would stop a call starting with these models; speech models only count for an agent that talks
  const modelProblem = (read.voiceChannel ? (['llm', 'stt', 'tts'] as const) : (['llm'] as const)).map((stage) => slotProblem(stage, models[stage], providers)).find(Boolean) ?? null;
  const voice = voiceInUse(models.tts);
  const voiceValue = models.tts.voiceId ? `${voice?.name ?? 'A voice from your own account'}${models.tts.provider ? ` · ${providerLabel(models.tts.provider)}` : ''}` : '';
  const more = spokenChips({ primary: languages.primary, speaks: languages.speaks }).filter((c) => !c.main).map((c) => c.name);
  const languageValue = languages.primary ? `${languageName(languages.primary)}${more.length ? ` · also ${inWords(more)}` : ''}${languages.autoDetect ? ' · detects the caller’s' : ''}` : '';
  const modelsValue = summarizeModels(config)
    .filter((m) => m.set)
    .map((m) => `${m.label}: ${m.providerName}${m.modelName ? ` ${m.modelName}` : ''}`)
    .join(' · ');
  const behaviourValue = [read.tone, read.styleRules.length ? `${read.styleRules.length} style rule${read.styleRules.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
  const sharedRules = read.sharedRules.filter((r) => r.trim()).length;
  const personaValue = [
    read.persona.trim() ? `Introduces itself as “${read.persona.trim()}”${read.company.trim() ? ` from ${read.company.trim()}` : ''}` : '',
    sharedRules ? `${sharedRules} rule${sharedRules === 1 ? '' : 's'} for every agent` : '',
  ].filter(Boolean).join(' · ');

  const stale = renamed ? staleNameParts(config, renamed.from, renamed.to, greetingFor) : [];

  return (
    <div className="space-y-8">
      <Section title="Name" lead="Shown in your list of agents. The name it introduces itself by is under Personality and rules.">
        <div id={fieldId('meta.name')} className="scroll-mt-28 rounded-md">
          <input
            id={`${fieldId('meta.name')}-input`}
            className={cn(inputClass, 'max-w-md', nameError && inputErrorClass)}
            value={read.name}
            disabled={disabled}
            aria-label="Agent name"
            aria-invalid={nameError ? true : undefined}
            onFocus={() => {
              nameAtFocus.current = read.name;
            }}
            onChange={(e) => set(setAgentName(config, e.target.value))}
            onBlur={() => {
              const from = nameAtFocus.current.trim();
              const to = read.name.trim();
              setRenamed(from && to && from !== to ? { from, to } : null);
            }} />
          {nameError && <p className="mt-1.5 text-[13px] text-danger">{nameError}</p>}
        </div>
        {renamed && stale.length > 0 &&
        <p role="status" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-info-soft px-3 py-2 text-[13px] text-ink-soft">
            <span>{staleSentence(stale, renamed.from)}</span>
            <button
            type="button"
            disabled={disabled}
            className="font-medium text-accent hover:underline"
            onClick={() => {
              set(stale.reduce((next, part) => part.change(next), config));
              setRenamed(null);
            }}>
              Change {stale.length === 1 ? 'it' : 'them'} to “{renamed.to}”
            </button>
            <button type="button" className="font-medium text-ink-soft hover:underline" onClick={() => setRenamed(null)}>
              Leave {stale.length === 1 ? 'it' : 'them'}
            </button>
          </p>
        }
      </Section>

      <Section title="What it should do" lead="Write to the agent as you would brief a person: who it helps, what it does, what it must not do. This is what the agent that answers first is told.">
        {entry < 0 ?
        <p className="text-sm text-muted">This agent has no agent to give instructions to yet. Add one in the Workflow or the JSON view.</p> :

        <div id={fieldId(['agents', 'items', entry, 'instructions'])} className="scroll-mt-28 space-y-3 rounded-md">
            <TemplateField
            id={`${fieldId(['agents', 'items', entry, 'instructions'])}-input`}
            ariaLabel="What the agent should do (its role)"
            value={read.role}
            invalid={!!roleError}
            disabled={disabled}
            scope={scope}
            rows={9}
            showCount
            placeholder="For example: You help Acme Dental’s patients book, move and cancel appointments. Ask one question at a time. You never give medical advice: offer to pass them to a person instead."
            onChange={(text) => set(setRole(config, text))} />
            {roleError && <p className="text-[13px] text-danger">{roleError}</p>}
            <p data-flow className="text-[13px] text-muted" title={flow.lines.join('\n')}>
              {flow.sentence}
            </p>
            <InlinePromptPreview config={config} />
          </div>
        }
      </Section>

      <Section title="What it says first" lead="The first thing a caller hears or reads. Leave it empty and the agent waits for the caller to start.">
        <div id={fieldId(['channels', firstGreeting, 'greeting'])} className="scroll-mt-28 rounded-md">
          <input
            id={`${fieldId(['channels', firstGreeting, 'greeting'])}-input`}
            className={cn(inputClass, greetingError && inputErrorClass)}
            value={greeting.text}
            disabled={disabled || read.channels.length === 0}
            placeholder="Hello! How can I help you today?"
            aria-label="Greeting"
            aria-invalid={greetingError ? true : undefined}
            onChange={(e) => {
              const target = greetingFor ?? greetingTarget(config);
              if (!greetingFor) setGreetingFor(target);
              set(setGreeting(config, e.target.value, target));
            }} />
          {greetingError && <p className="mt-1.5 text-[13px] text-danger">{greetingError}</p>}
          <p data-greeting-hint className="mt-1.5 text-[13px] text-muted">
            {read.channels.length === 0 ? 'Add a channel first (Channels): the greeting is what a channel says when someone arrives.' : greetingHint(greeting)}
            {greeting.text && greeting.others.length > 0 && !disabled &&
            <>
                {' '}
                <button
                type="button"
                className="font-medium text-accent hover:underline"
                onClick={() => {
                  set(shareGreeting(config, greetingFor));
                  setGreetingFor(null);
                }}>
                  Say this on {inWords(greeting.others.map((o) => o.name))} too
                </button>
              </>
            }
          </p>
        </div>
      </Section>

      <Section title="How it sounds">
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          <SettingRow
            id={fieldId('defaults.models.tts.voice_id')}
            icon={AudioLinesIcon}
            title="Voice"
            value={voiceValue}
            // an agent that only chats needs no voice, and is not told it lacks one
            hint={read.voiceChannel ? 'No voice chosen yet' : 'Not needed while it only chats: choose one for phone calls or talking on your website'}
            status={status(count((p) => startsWith(p, 'defaults', 'models', 'tts')), 'voice')}
            onOpen={() => setOpen('voice')} />
          <SettingRow
            id={fieldId('defaults.language.primary')}
            icon={GlobeIcon}
            title="Language"
            value={languageValue}
            hint="No language chosen yet"
            status={status(count((p) => startsWith(p, 'defaults', 'language')), 'language')}
            onOpen={() => setOpen('language')} />
          <SettingRow
            icon={QuoteIcon}
            title="Tone and style"
            value={behaviourValue}
            hint="Not set"
            status={status(count((p) => startsWith(p, 'persona', 'tone') || startsWith(p, 'persona', 'style_rules')))}
            onOpen={() => setOpen('behaviour')} />
        </div>
      </Section>

      <Section title="What it runs on">
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          <SettingRow
            id={fieldId('defaults.models.llm.model')}
            icon={CpuIcon}
            title="AI models"
            value={modelsValue}
            hint="No models chosen yet: the server’s defaults are used"
            status={status(count((p) => startsWith(p, 'defaults', 'models')), 'model') ?? (modelProblem ? { tone: 'warning', text: modelProblem.short } : !providers && providersError ? { tone: 'warning', text: 'Not checked' } : null)}
            tip={modelProblem?.text ?? (!providers && providersError ? 'What the server can run could not be checked.' : undefined)}
            onOpen={() => setOpen('models')} />
        </div>
      </Section>

      <Section title="More">
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          <SettingRow
            icon={UserRoundIcon}
            title="Personality and rules"
            value={personaValue}
            hint="The name it introduces itself by, the company it speaks for, rules for every agent"
            status={status(count((p) => startsWith(p, 'persona', 'name') || startsWith(p, 'persona', 'company') || startsWith(p, 'persona', 'shared_rules')))}
            onOpen={() => setOpen('persona')} />
        </div>
      </Section>

      {open === 'voice' &&
      <SidePanel title="Voice" description="How it sounds on a call or when talking on your website." wide config={config} canEdit={editor.canEdit} onApply={set} onClose={() => setOpen(null)}>
          {(copy, change) => <VoicePicker config={copy} set={change} providers={providers} speech={readAgentPage(copy).voiceChannel} disabled={disabled} />}
        </SidePanel>
      }
      {open === 'language' &&
      <SidePanel title="Language" config={config} canEdit={editor.canEdit} onApply={set} onClose={() => setOpen(null)}>
          {(copy, change) => <LanguagePicker config={copy} set={change} disabled={disabled} />}
        </SidePanel>
      }
      {open === 'models' &&
      <SidePanel title="AI models" description="What listens, thinks and speaks during a conversation." wide config={config} canEdit={editor.canEdit} onApply={set} onClose={() => setOpen(null)}>
          {(copy, change) => <ModelPicker config={copy} set={change} providers={providers} providersError={providersError} speech={readAgentPage(copy).voiceChannel} disabled={disabled} />}
        </SidePanel>
      }
      {open === 'behaviour' &&
      <SidePanel title="Tone and style" config={config} canEdit={editor.canEdit} onApply={set} onClose={() => setOpen(null)}>
          {(copy, change) => {
          const now = readAgentPage(copy);
          return (
            <div className="space-y-5">
                <label className="block">
                  <span className="text-sm font-medium text-ink">Tone</span>
                  <input className={cn(inputClass, 'mt-1.5')} value={now.tone} disabled={disabled} placeholder="For example: warm, concise, plain language" aria-label="Tone" onChange={(e) => change(setPersona(copy, 'tone', e.target.value))} />
                  <span className="mt-1 block text-[13px] text-muted">How it sounds, in a few words.</span>
                </label>
                <RuleList label="Style rules" help="Short rules about how it talks. Rules about what it may do belong in its instructions." values={now.styleRules} placeholder="For example: One question at a time." addLabel="Add a rule" disabled={disabled} onChange={(rules) => change(setPersona(copy, 'style_rules', rules))} />
              </div>);

        }}
        </SidePanel>
      }
      {open === 'persona' &&
      <SidePanel title="Personality and rules" wide config={config} canEdit={editor.canEdit} onApply={set} onClose={() => setOpen(null)}>
          {(copy, change) => {
          const now = readAgentPage(copy);
          return (
            <div className="space-y-5">
                <label className="block">
                  <span className="text-sm font-medium text-ink">The name it introduces itself by</span>
                  <input className={cn(inputClass, 'mt-1.5')} value={now.persona} disabled={disabled} aria-label="The name it introduces itself by" onChange={(e) => change(setPersona(copy, 'name', e.target.value))} />
                  <span className="mt-1 block text-[13px] text-muted">For example “Ada”. It follows the agent’s name until you give it one of its own.</span>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-ink">The company it speaks for</span>
                  <input className={cn(inputClass, 'mt-1.5')} value={now.company} disabled={disabled} aria-label="The company it speaks for" onChange={(e) => change(setPersona(copy, 'company', e.target.value))} />
                </label>
                <RuleList label="Rules for every agent" help="Instructions every agent of this one follows, whoever is talking." values={now.sharedRules} placeholder="For example: Never guess an account balance." addLabel="Add a rule" disabled={disabled} onChange={(rules) => change(setPersona(copy, 'shared_rules', rules))} />
                <p className="text-[13px] text-muted">Tone and style rules are under Tone and style; what callers hear about recording is under After the call.</p>
              </div>);

        }}
        </SidePanel>
      }
    </div>);

}

function Section({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {lead && <p className="mb-3 mt-0.5 max-w-2xl text-[13px] leading-relaxed text-muted">{lead}</p>}
      {!lead && <div className="mb-3" />}
      {children}
    </section>);

}

/** A row that summarises one topic and opens its panel. */
function SettingRow({ id, icon: Icon, title, value, hint, status, tip, onOpen }: { id?: string; icon: LucideIcon; title: string; value: string; hint: string; status: { tone: 'danger' | 'warning'; text: string } | null; tip?: string; onOpen: () => void }) {
  return (
    <div id={id} className="scroll-mt-28">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${title}: ${value || hint}. Change`}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-subtle/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-subtle text-ink-soft">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block text-sm font-medium text-ink">{title}</strong>
          <small className={cn('block truncate text-[13px]', value ? 'text-ink-soft' : 'text-muted')}>{value || hint}</small>
        </span>
        {status &&
        <span title={tip}>
            <StatusChip tone={status.tone} dot>
              {status.text}
            </StatusChip>
          </span>
        }
        <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      </button>
    </div>);

}

/** A list of short lines (rules): edit each, take one away, add another. */
function RuleList({ label, help, values, placeholder, addLabel, disabled, onChange }: { label: string; help: string; values: string[]; placeholder: string; addLabel: string; disabled?: boolean; onChange: (values: string[]) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">{label}</legend>
      <p className="mb-2 mt-0.5 text-[13px] text-muted">{help}</p>
      <ul className="space-y-2">
        {values.map((value, i) =>
        <li key={i} className="flex items-center gap-2">
            <input className={inputClass} value={value} disabled={disabled} placeholder={placeholder} aria-label={`${label} ${i + 1}`} onChange={(e) => onChange(values.map((v, j) => (j === i ? e.target.value : v)))} />
            <button type="button" disabled={disabled} aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(values.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <XIcon className="h-4 w-4" aria-hidden />
            </button>
          </li>
        )}
      </ul>
      <button type="button" disabled={disabled} onClick={() => onChange([...values, ''])} className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline disabled:opacity-50">
        <PlusIcon className="h-3.5 w-3.5" aria-hidden />
        {addLabel}
      </button>
    </fieldset>);

}
