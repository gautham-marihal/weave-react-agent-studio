import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { groupIssues } from '../../../api/client.ts';
import PromptPreview from '../../form/PromptPreview.jsx';
import TemplateField from '../../form/TemplateField.jsx';
import { StringList } from '../../form/fields.jsx';
import { templateScope } from '../../form/templates.ts';
import { readDataFlow } from '../../records/recordsModel.js';
import LanguagePicker from '../pickers/LanguagePicker.jsx';
import ModelPicker from '../pickers/ModelPicker.jsx';
import VoicePicker from '../pickers/VoicePicker.jsx';
import SimpleKey, { JsonOpenerCtx } from '../../simple/SimpleKey.jsx';
import {
  entryAgentIndex,
  greetingOf,
  greetingTarget,
  languageName,
  readSimple,
  setAgentName,
  setGreeting,
  setRole,
  setStyleRules,
  setTone,
  shareGreeting,
} from '../../simple/simpleModel.js';
import { spokenChips } from '../pickers/pickerLogic.js';
import { locate } from '../pages.js';
import { providerLabel } from '../../models/catalog.js';
import { readModels, slotProblem, summarizeModels, voicesFor } from '../../models/config.js';
import { useProviders } from '../../models/useProviders.js';
import { Notice, Spinner } from '../../ui.jsx';
import PageShell, { Section, SettingRow } from '../PageShell.jsx';
import { StagedDrawer } from '../Drawer.jsx';
import '../../simple/simple.css';

const FormEditor = lazy(() => import('../../form/FormEditor.jsx'));

function BehaviourFields({ config, set }) {
  const read = readSimple(config);
  return (
    <div className="smFields">
      <div className="smField">
        <span>
          <label htmlFor="nl-tone">Tone</label> <SimpleKey path={['persona', 'tone']} />
        </span>
        <input
          id="nl-tone"
          className="stFInput"
          type="text"
          value={read.tone}
          placeholder="e.g. warm, concise, plain language"
          onChange={(event) => set(setTone(config, event.target.value))}
          aria-label="Tone"
        />
        <small>How it sounds, in a few words.</small>
      </div>
      <div className="smField">
        <span>
          Style rules <SimpleKey path={['persona', 'style_rules']} />
        </span>
        <StringList
          values={read.styleRules}
          onChange={(list) => set(setStyleRules(config, list))}
          placeholder="e.g. One question at a time."
          addLabel="Add a rule"
        />
        <small>Short rules about how it talks. Rules about what it may do belong in its instructions.</small>
      </div>
    </div>
  );
}

// "Web chat", "Web chat and Phone", "Web chat, Phone and SMS" (each name once)
const inWords = (names) => {
  const each = [...new Set(names)];
  return each.length > 1 ? `${each.slice(0, -1).join(', ')} and ${each.at(-1)}` : each[0] || '';
};
const says = (names, verb) => `${inWords(names)} ${new Set(names).size === 1 ? `${verb}s` : verb}`;

// The line under the greeting: which channels say it (or wait for the caller), and what other channels say instead.
//   greeting: from greetingOf
function greetingHint(greeting) {
  const others = greeting.others.map((o) => `${o.name} says “${o.text}”.`).join(' ');
  if (!greeting.text) {
    if (!others && greeting.every) return 'Not set yet: type one and every channel will say it.';
    const waiting = greeting.waiting.length ? `${says(greeting.waiting, 'wait')} for the caller to start until you type a line here. ` : '';
    return `${waiting}${others}`.trim();
  }
  const reference = greeting.reference ? 'This greeting is one of the agent’s messages; changing it changes that message.' : '';
  if (!others) return reference || `Used on ${greeting.saying.length} channel${greeting.saying.length === 1 ? '' : 's'}.`;
  return `${says(greeting.saying, 'say')} this. ${others} ${reference}`.trim();
}

function ModelsBody({ config, set }) {
  const { providers, live } = useProviders();
  return <ModelPicker config={config} set={set} providers={providers} live={live} speech={readSimple(config).voiceChannel} />;
}

// The Agent page: what it should do, what it says first, and the choices that make it sound like itself. Choices are
// rows that open a panel on one topic; only "Done" puts the panel's changes into the draft.
//   plan: readiness steps (readiness.js); one still to do on this page marks its row or field
export default function AgentPage({ editor, onShowJson, onOpenJson, onShowModels, openRequest = null, notices = null, plan = null }) {
  const config = editor.parsed.value;
  const [open, setOpen] = useState(null); // 'voice' | 'language' | 'models' | 'behaviour' | 'persona' | 'messages'
  // the channels the greeting writes to, fixed at its first change this visit, so emptying and retyping keeps them and
  // a channel with its own greeting is never overwritten
  const [greetingFor, setGreetingFor] = useState(null);
  // "Show me" on a problem opens the panel that holds it
  useEffect(() => {
    if (openRequest?.id || openRequest?.open) setOpen(openRequest.id || openRequest.open);
  }, [openRequest]);
  // a Home step about a field on this page: scroll the field into view and focus it
  useEffect(() => {
    const label = { role: 'What the agent should do (its role)', greeting: 'Greeting' }[openRequest?.focus];
    if (!label) return;
    // not cancelled when the request clears: it is for this visit, and the field appears a moment after the page
    window.setTimeout(() => {
      const el = [...document.querySelectorAll('textarea, input')].find((node) => node.getAttribute('aria-label') === label);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.focus({ preventScroll: true });
      }
    }, 60);
  }, [openRequest]);
  const read = readSimple(config);
  const greeting = greetingOf(config, greetingFor);
  const models = readModels(config);
  const scope = useMemo(() => templateScope(config), [config]);
  const issues = useMemo(() => groupIssues(editor.report).filter((i) => i.severity === 'error' && i.path), [editor.report]);
  const errors = (match) => issues.filter(match).length;
  // readiness steps on this page not yet done: their row says "To do" (a problem to fix says so instead)
  const todo = (plan?.steps || []).filter((step) => step.page === 'agent' && (step.state === 'todo' || step.state === 'blocked'));
  const todoOpen = new Set(todo.map((step) => step.target?.open).filter(Boolean));
  const status = (n, panel) => (n ? { tone: 'bad', text: `${n} to fix` } : panel && todoOpen.has(panel) ? { tone: 'warn', text: 'To do' } : null);
  // a problem with one of the page's fields is shown under it in words (the checks name the path)
  const entry = entryAgentIndex(config);
  const fieldError = (match, plain) => {
    const found = issues.find((i) => match(i.path));
    return found ? plain(found) : '';
  };
  const nameError = fieldError(
    (p) => p[0] === 'meta' && p[1] === 'name',
    () => 'Give it a name: it is how you find it in your list of agents.',
  );
  const roleError = fieldError(
    (p) => p[0] === 'agents' && p[1] === 'items' && p[2] === entry && p[3] === 'instructions',
    (i) => (/required|empty|at least/i.test(i.message || '') ? 'Say what it should do: it can’t answer anyone without this.' : i.message),
  );
  const greetingError = fieldError(
    (p) => p[0] === 'channels' && p[2] === 'greeting',
    (i) => i.message || 'Check what it says first.',
  );
  const set = (next) => {
    if (next !== config) editor.setValue(next);
  };

  // what would stop a call starting with these models (a missing key, an unsupported provider), shown on the row too;
  // speech models only count for an agent that talks
  const { providers } = useProviders();
  const modelProblem = ['llm', ...(read.voiceChannel ? ['stt', 'tts'] : [])].map((stage) => slotProblem(stage, models[stage], providers)).find(Boolean);
  const voice = voicesFor(models.tts.provider).find((v) => v.voiceId === models.tts.voiceId);
  const voiceValue = models.tts.voiceId ? `${voice?.name || 'Custom voice'}${models.tts.provider ? ` · ${providerLabel(models.tts.provider)}` : ''}` : '';
  // the other languages by name, as the panel shows them (the main language's base, "en" for en-US, isn't counted)
  const moreLanguages = spokenChips({ primary: read.primaryLanguage, speaks: read.speaks })
    .filter((chip) => !chip.main)
    .map((chip) => chip.name);
  const languageValue = read.primaryLanguage ? `${languageName(read.primaryLanguage)}${moreLanguages.length ? ` · also ${inWords(moreLanguages)}` : ''}` : '';
  // with the models' display names: "Language model: OpenAI GPT-4.1 Mini · …", not "LLM openai gpt-4.1-mini"
  const modelsValue = ['llm', 'stt', 'tts']
    .map((id) => summarizeModels(config).find((m) => m.stage === id))
    .filter((m) => m && m.set)
    .map((m) => `${m.label}: ${m.providerName}${m.modelName ? ` ${m.modelName}` : ''}`)
    .join(' · ');
  const behaviourValue = [read.tone, read.styleRules.length ? `${read.styleRules.length} style rule${read.styleRules.length === 1 ? '' : 's'}` : '']
    .filter(Boolean)
    .join(' · ');
  // the Personality and rules row summarises its panel: the name, the company, how many rules every agent gets
  const persona = config && typeof config.persona === 'object' && config.persona ? config.persona : {};
  const sharedRules = Array.isArray(persona.shared_rules) ? persona.shared_rules.filter((r) => typeof r === 'string' && r.trim()).length : 0;
  const personaValue = [
    typeof persona.name === 'string' && persona.name.trim()
      ? `Introduces itself as “${persona.name.trim()}”${typeof persona.company === 'string' && persona.company.trim() ? ` from ${persona.company.trim()}` : ''}`
      : '',
    sharedRules ? `${sharedRules} rule${sharedRules === 1 ? '' : 's'} for every agent` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  // the Fixed lines row: how many there are, and in how many languages
  const lines = Array.isArray(config?.messages) ? config.messages.filter((m) => m && typeof m === 'object') : [];
  const lineLanguages = new Set(lines.flatMap((m) => (m.text && typeof m.text === 'object' ? Object.keys(m.text) : [])));
  const linesValue = lines.length
    ? `${lines.length} fixed line${lines.length === 1 ? '' : 's'}${lineLanguages.size > 1 ? ` in ${lineLanguages.size} languages` : ''}`
    : '';

  // after a rename, the greeting, persona name and instructions may still say the old name: offered once the name box
  // is left, never changed unasked
  const nameAtFocus = useRef('');
  const [renamed, setRenamed] = useState(null); // { from, to }
  const oldNameIn = (text, name) => !!name && typeof text === 'string' && text.includes(name);
  const replaceName = (text, from, to) => text.split(from).join(to);
  const stale = renamed
    ? [
        oldNameIn(greeting.text, renamed.from) && {
          words: 'what it says first',
          change: (c) => setGreeting(c, replaceName(greeting.text, renamed.from, renamed.to), greetingFor || greetingTarget(c)),
        },
        typeof persona.name === 'string' &&
          persona.name.trim() === renamed.from && {
            words: 'the name it introduces itself by',
            change: (c) => ({ ...c, persona: { ...c.persona, name: renamed.to } }),
          },
        oldNameIn(read.role, renamed.from) && {
          words: 'its instructions',
          plural: true,
          change: (c) => setRole(c, replaceName(read.role, renamed.from, renamed.to)),
        },
      ].filter(Boolean)
    : [];

  // hide: what another panel or page already asks for, so a person is asked once
  const form = (keys, hide) => (staged) => (
    <Suspense fallback={<Spinner label="Loading the settings" />}>
      <FormEditor editor={staged} only={keys} hide={hide} embedded onShowJson={onShowJson} onOpenJson={onOpenJson} onShowModels={onShowModels} />
    </Suspense>
  );
  const drawers = {
    voice: { title: 'Voice', icon: 'voice', width: 'wide', body: (c, s) => <VoicePicker config={c} set={s} speech={readSimple(c).voiceChannel} /> },
    language: { title: 'Language', icon: 'globe', body: (c, s) => <LanguagePicker config={c} set={s} /> },
    models: { title: 'AI models', icon: 'sparkle', width: 'wide', body: (c, s) => <ModelsBody config={c} set={s} /> },
    behaviour: { title: 'Tone and style', icon: 'quote', body: (c, s) => <BehaviourFields config={c} set={s} /> },
    // tone and style rules are under Tone and style; the recording notice is under After the call › Recording
    persona: {
      title: 'Personality and rules',
      icon: 'pencil',
      width: 'wide',
      body: (c, s, staged) =>
        form(
          ['persona'],
          [
            ['persona', 'tone'],
            ['persona', 'style_rules'],
            ['persona', 'disclosures'],
          ],
        )(staged),
    },
    messages: { title: 'Fixed lines', icon: 'records', width: 'wide', body: (c, s, staged) => form(['messages'])(staged) },
  };
  const drawer = open ? drawers[open] : null;

  if (editor.parsed.error || !config || typeof config !== 'object') {
    return (
      <PageShell title="Agent">
        <Notice
          kind="warn"
          title="The JSON needs fixing first"
          actions={
            <button type="button" className="quietButton" onClick={onShowJson}>
              Open the JSON
            </button>
          }
        >
          This page reads the draft, which isn’t valid JSON right now.
        </Notice>
      </PageShell>
    );
  }
  return (
    <JsonOpenerCtx.Provider value={onOpenJson || null}>
      <PageShell title="Agent" lead="Who it is, what it should do, and how it sounds.">
        {notices}
        <Section title="Name" lead="Shown in your list of agents. The name it introduces itself by is under Personality and rules.">
          <input
            className="stFInput"
            type="text"
            value={read.name}
            onFocus={() => {
              nameAtFocus.current = read.name;
            }}
            onChange={(event) => set(setAgentName(config, event.target.value))}
            onBlur={() => {
              const from = nameAtFocus.current.trim();
              const to = read.name.trim();
              setRenamed(from && to && from !== to ? { from, to } : null);
            }}
            aria-label="Agent name"
            aria-invalid={nameError ? true : undefined}
          />
          {nameError && <small className="stFieldError">{nameError}</small>}
          {stale.length > 0 && (
            <p className="nlHint nlRenamed" role="status">
              {(() => {
                const words = inWords(stale.map((part) => part.words));
                return `${words.charAt(0).toUpperCase()}${words.slice(1)} still ${stale.length === 1 && !stale[0].plural ? 'says' : 'say'} “${renamed.from}”.`;
              })()}{' '}
              <button
                type="button"
                className="linkButton"
                onClick={() => {
                  set(stale.reduce((next, part) => part.change(next), config));
                  setRenamed(null);
                }}
              >
                Change {stale.length === 1 ? 'it' : 'them'} to “{renamed.to}”
              </button>{' '}
              <button type="button" className="linkButton" onClick={() => setRenamed(null)}>
                Leave {stale.length === 1 ? 'it' : 'them'}
              </button>
            </p>
          )}
        </Section>

        <Section
          title="What it should do"
          lead="Write to the agent as you would brief a person: who it helps, what it does, what it must not do. This is what the agent that answers first is told."
        >
          <TemplateField
            ariaLabel="What the agent should do (its role)"
            value={read.role}
            invalid={!!roleError}
            // the three things a brief says, as an example: who it helps, what it does, what it must not do
            placeholder="For example: You help Acme Dental’s patients book, move and cancel appointments. Ask one question at a time. You never give medical advice: offer to pass them to a person instead."
            onChange={(text) => set(setRole(config, text))}
            scope={scope}
            multiline
            rows={9}
            mono={false}
            showCount
            plain
          />
          {roleError && <small className="stFieldError">{roleError}</small>}
          <p className="nlHint">{readDataFlow(config).sentence}</p>
          {read.agentId && <PromptPreview agentId={read.agentId} config={config} />}
        </Section>

        <Section title="What it says first" lead="The first thing a caller hears or reads. Leave it empty and the agent waits for the caller to start.">
          <input
            className="stFInput"
            type="text"
            value={greeting.text}
            disabled={read.channels.length === 0}
            placeholder={greeting.text ? undefined : 'Hello! How can I help you today?'}
            onChange={(event) => {
              const target = greetingFor || greetingTarget(config);
              if (!greetingFor) setGreetingFor(target);
              set(setGreeting(config, event.target.value, target));
            }}
            aria-label="Greeting"
            aria-invalid={greetingError ? true : undefined}
          />
          {greetingError && <small className="stFieldError">{greetingError}</small>}
          <p className="nlHint">
            {read.channels.length === 0
              ? 'Add a channel first (Channels page): the greeting is what a channel says when someone arrives.'
              : greetingHint(greeting)}
            {greeting.text && greeting.others.length > 0 && (
              <>
                {' '}
                <button
                  type="button"
                  className="linkButton"
                  onClick={() => {
                    set(shareGreeting(config, greetingFor));
                    setGreetingFor(null);
                  }}
                >
                  Say this on {inWords(greeting.others.map((o) => o.name))} too
                </button>
              </>
            )}
          </p>
        </Section>

        <Section title="How it sounds">
          <div className="nlRows">
            <SettingRow
              icon="voice"
              title="Voice"
              value={voiceValue}
              // an agent that only chats needs no voice, and is not told it lacks one
              hint={read.voiceChannel ? 'No voice chosen yet' : 'Not needed while it only chats: choose one for phone calls or talking on your website'}
              status={status(
                errors((i) => i.path[0] === 'defaults' && i.path[1] === 'models' && i.path[2] === 'tts'),
                'voice',
              )}
              onOpen={() => setOpen('voice')}
            />
            <SettingRow
              icon="globe"
              title="Language"
              value={languageValue}
              hint="No language chosen yet"
              status={status(
                errors((i) => i.path[0] === 'defaults' && i.path[1] === 'language'),
                'language',
              )}
              onOpen={() => setOpen('language')}
            />
            <SettingRow
              icon="quote"
              title="Tone and style"
              value={behaviourValue}
              hint="Not set"
              status={status(errors((i) => locate(i.path).drawer === 'behaviour'))}
              onOpen={() => setOpen('behaviour')}
            />
          </div>
        </Section>

        <Section title="What it runs on">
          <div className="nlRows">
            <SettingRow
              icon="sparkle"
              title="AI models"
              value={modelsValue}
              hint="No models chosen yet"
              status={
                status(
                  errors((i) => i.path[0] === 'defaults' && i.path[1] === 'models'),
                  'models',
                ) || (modelProblem ? { tone: 'warn', text: modelProblem.short } : null)
              }
              tip={modelProblem?.text}
              onOpen={() => setOpen('models')}
            />
          </div>
        </Section>

        <Section title="More">
          <div className="nlRows">
            <SettingRow
              icon="pencil"
              title="Personality and rules"
              value={personaValue}
              hint="The name it introduces itself by, the company it speaks for, rules for every agent"
              // not what its panel leaves out (tone and style rules and the recording notice live elsewhere)
              status={status(errors((i) => locate(i.path).drawer === 'persona'))}
              onOpen={() => setOpen('persona')}
            />
            <SettingRow
              icon="records"
              title="Fixed lines"
              value={linesValue}
              hint="None yet: lines it always says the same way, such as a goodbye, in each language"
              status={status(errors((i) => i.path[0] === 'messages'))}
              onOpen={() => setOpen('messages')}
            />
          </div>
        </Section>

        {drawer && (
          <StagedDrawer key={open} editor={editor} title={drawer.title} icon={drawer.icon} width={drawer.width} onClose={() => setOpen(null)}>
            {drawer.body}
          </StagedDrawer>
        )}
      </PageShell>
    </JsonOpenerCtx.Provider>
  );
}
