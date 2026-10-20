import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { groupIssues } from '../../../api/client.js';
import PromptPreview from '../../form/PromptPreview.jsx';
import TemplateField from '../../form/TemplateField.jsx';
import { StringList } from '../../form/fields.jsx';
import { templateScope } from '../../form/templates.js';
import { readDataFlow } from '../../records/recordsModel.js';
import LanguagePicker from '../pickers/LanguagePicker.jsx';
import ModelPicker from '../pickers/ModelPicker.jsx';
import VoicePicker from '../pickers/VoicePicker.jsx';
import SimpleKey, { JsonOpenerCtx } from '../../simple/SimpleKey.jsx';
import { languageName, readSimple, setAgentName, setGreeting, setRole, setStyleRules, setTone } from '../../simple/simpleModel.js';
import { providerLabel } from '../../models/catalog.js';
import { readModels, voicesFor } from '../../models/config.js';
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

function ModelsBody({ config, set }) {
  const { providers, live } = useProviders();
  return <ModelPicker config={config} set={set} providers={providers} live={live} />;
}

// The agent's own page: what it should do, what it says first, and the few choices that make it sound like itself. The text you write is on the page; the
// choices (voice, language, models, behaviour) are rows that open a panel with just that topic, and only "Done" puts the panel's changes into the draft.
export default function AgentPage({ editor, onShowJson, onOpenJson, openRequest = null, notices = null }) {
  const config = editor.parsed.value;
  const [open, setOpen] = useState(null); // 'voice' | 'language' | 'models' | 'behaviour' | 'persona' | 'messages'
  // "Show me" on a problem opens the panel that holds it
  useEffect(() => {
    if (openRequest?.id || openRequest?.open) setOpen(openRequest.id || openRequest.open);
  }, [openRequest]);
  // a step on Home that is about a field on this page: bring the field into view and put the cursor in it
  useEffect(() => {
    const label = { role: 'What the agent should do (its role)', greeting: 'Greeting' }[openRequest?.focus];
    if (!label) return;
    // not cancelled when the request is cleared at once: the request is for this visit, and the field is there a moment after the page
    window.setTimeout(() => {
      const el = [...document.querySelectorAll('textarea, input')].find((node) => node.getAttribute('aria-label') === label);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.focus({ preventScroll: true });
      }
    }, 60);
  }, [openRequest]);
  const read = readSimple(config);
  const models = readModels(config);
  const scope = useMemo(() => templateScope(config), [config]);
  const issues = useMemo(() => groupIssues(editor.report).filter((i) => i.severity === 'error' && i.path), [editor.report]);
  const errors = (match) => issues.filter(match).length;
  const status = (n) => (n ? { tone: 'bad', text: `${n} to fix` } : null);
  const set = (next) => {
    if (next !== config) editor.setValue(next);
  };

  const voice = voicesFor(models.tts.provider).find((v) => v.voiceId === models.tts.voiceId);
  const voiceValue = models.tts.voiceId ? `${voice?.name || 'Custom voice'}${models.tts.provider ? ` · ${providerLabel(models.tts.provider)}` : ''}` : '';
  const languageValue = read.primaryLanguage ? `${languageName(read.primaryLanguage)}${read.speaks.length ? ` and ${read.speaks.length} more` : ''}` : '';
  const modelsValue = ['llm', 'stt', 'tts']
    .map((id) => (models[id].provider ? `${id.toUpperCase()} ${providerLabel(models[id].provider)}${models[id].model ? ` ${models[id].model}` : ''}` : ''))
    .filter(Boolean)
    .join(' · ');
  const behaviourValue = [read.tone, read.styleRules.length ? `${read.styleRules.length} style rule${read.styleRules.length === 1 ? '' : 's'}` : '']
    .filter(Boolean)
    .join(' · ');

  const form = (keys) => (staged) => (
    <Suspense fallback={<Spinner label="Loading the settings" />}>
      <FormEditor editor={staged} only={keys} embedded onShowJson={onShowJson} onOpenJson={onOpenJson} />
    </Suspense>
  );
  const drawers = {
    voice: { title: 'Voice', icon: 'voice', width: 'wide', body: (c, s) => <VoicePicker config={c} set={s} /> },
    language: { title: 'Language', icon: 'globe', body: (c, s) => <LanguagePicker config={c} set={s} /> },
    models: { title: 'AI models', icon: 'sparkle', width: 'wide', body: (c, s) => <ModelsBody config={c} set={s} /> },
    behaviour: { title: 'Tone and style', icon: 'quote', body: (c, s) => <BehaviourFields config={c} set={s} /> },
    persona: { title: 'Personality and rules', icon: 'pencil', width: 'wide', body: (c, s, staged) => form(['persona'])(staged) },
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
        <Section title="Name">
          <input
            className="stFInput"
            type="text"
            value={read.name}
            onChange={(event) => set(setAgentName(config, event.target.value))}
            aria-label="Agent name"
          />
        </Section>

        <Section
          title="What it should do"
          lead="Write to the agent as you would brief a person: who it helps, what it does, what it must not do. This is what the agent that answers first is told."
        >
          <TemplateField
            ariaLabel="What the agent should do (its role)"
            value={read.role}
            onChange={(text) => set(setRole(config, text))}
            scope={scope}
            multiline
            rows={9}
            mono={false}
            showCount
          />
          <p className="nlHint">{readDataFlow(config).sentence}</p>
          {read.agentId && <PromptPreview agentId={read.agentId} config={config} />}
        </Section>

        <Section title="What it says first" lead="The first thing a caller hears or reads. Leave it empty and the agent waits for the caller to start.">
          <input
            className="stFInput"
            type="text"
            value={read.greeting}
            disabled={read.channels.length === 0}
            placeholder={read.greetingChannels === 0 ? 'Hello! How can I help you today?' : undefined}
            onChange={(event) => set(setGreeting(config, event.target.value))}
            aria-label="Greeting"
          />
          <p className="nlHint">
            {read.channels.length === 0
              ? 'Add a channel first (Channels page): the greeting is what a channel says when someone arrives.'
              : read.greetingChannels === 0
                ? 'Not set yet: type one and every channel will say it.'
                : read.greetingIsReference
                  ? 'This greeting is one of the agent’s messages; changing it changes that message.'
                  : `Used on ${read.greetingChannels} channel${read.greetingChannels === 1 ? '' : 's'}.`}
          </p>
        </Section>

        <Section title="How it sounds">
          <div className="nlRows">
            <SettingRow
              icon="voice"
              title="Voice"
              value={voiceValue}
              hint="No voice chosen yet"
              status={status(errors((i) => i.path[0] === 'defaults' && i.path[1] === 'models' && i.path[2] === 'tts'))}
              onOpen={() => setOpen('voice')}
            />
            <SettingRow
              icon="globe"
              title="Language"
              value={languageValue}
              hint="No language chosen yet"
              status={status(errors((i) => i.path[0] === 'defaults' && i.path[1] === 'language'))}
              onOpen={() => setOpen('language')}
            />
            <SettingRow icon="quote" title="Tone and style" value={behaviourValue} hint="Not set" onOpen={() => setOpen('behaviour')} />
          </div>
        </Section>

        <Section title="What it runs on">
          <div className="nlRows">
            <SettingRow
              icon="sparkle"
              title="AI models"
              value={modelsValue}
              hint="No models chosen yet"
              status={status(errors((i) => i.path[0] === 'defaults' && i.path[1] === 'models'))}
              onOpen={() => setOpen('models')}
            />
          </div>
        </Section>

        <Section title="More">
          <div className="nlRows">
            <SettingRow
              icon="pencil"
              title="Personality and rules"
              value="Name it speaks as, disclosures, rules"
              status={status(errors((i) => i.path[0] === 'persona'))}
              onOpen={() => setOpen('persona')}
            />
            <SettingRow
              icon="records"
              title="Fixed lines"
              value="The greeting, the goodbye and other lines it always says, in each language"
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
