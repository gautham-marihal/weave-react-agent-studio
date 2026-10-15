import React, { Suspense, lazy, useMemo, useState } from 'react';
import SmartSelect from '../SmartSelect.jsx';
import { groupIssues } from '../../api/client.js';
import { collectSecretNames } from '../form/engine.js';
import { StringList } from '../form/fields.jsx';
const FormEditor = lazy(() => import('../form/FormEditor.jsx')); // the full form is loaded when a card asks for its detailed settings
import PromptPreview from '../form/PromptPreview.jsx';
import TemplateField from '../form/TemplateField.jsx';
import { createAndPoint, createProblems } from '../form/inlineCreate.js';
import { templateScope } from '../form/templates.js';
import ModelsEditor from '../models/ModelsEditor.jsx';
import { STAGES, isRecommendedModel, modelStatus, modelsFor, providerLabel, providersForStage } from '../models/catalog.js';
import SuggestInput from '../form/SuggestInput.jsx';
import { readModels, setModel, setProvider, setVoiceId, voicesFor } from '../models/config.js';
import GenderToggle, { useVoiceGender } from '../models/GenderToggle.jsx';
import { useProviders } from '../models/useProviders.js';
import { Notice, Spinner } from '../ui.jsx';
import Icon from '../../ui/Icon.jsx';
import { readDataFlow } from '../records/recordsModel.js';
import { plainToolKind } from '../form/plainKinds.js';
import { describeRecords } from '../records/recordsModel.js';
import WhereCard from './WhereCard.jsx';
import RecordsCard from './RecordsCard.jsx';
import { BASE_LANGUAGES, LANGUAGES, languageName, readConnections, readSimple, readTools, setAgentName, setGreeting, setPrimaryLanguage, setRecordingNotice, setRole, setStyleRules, setTone, toggleSpoken } from './simpleModel.js';
import './simple.css';

// The Simple view of an agent: a few cards for the everyday decisions, in the customer's words: personality and instructions, voice and
// language, the AI model, what it can do, where it is available, and what is kept about each call. Each card shows what it is in one line;
// open it to change the everyday settings, and ask for "Detailed settings" to see everything the configuration has about that part (the
// ordinary form, limited to the right sections). Below the cards, the parts used less often are one click away: "More" for the everyday
// ones, "Advanced" for the engine's own. It edits the same draft as the form and the JSON, so the three always agree.

const CARDS = [
  { id: 'instructions', title: 'Personality and instructions', icon: 'pencil', blurb: 'Who the agent is, what it does and how it talks', sections: ['persona', 'agents', 'messages', 'state'] },
  { id: 'voice', title: 'Voice and language', icon: 'voice', blurb: 'The language it speaks and the voice it uses', sections: ['defaults'] },
  { id: 'model', title: 'AI model', icon: 'sparkle', blurb: 'What it listens, thinks and speaks with', sections: [] },
  { id: 'connections', title: 'What it can do', icon: 'tools', blurb: 'The tools, knowledge and systems it can use', sections: ['connections', 'tools', 'knowledge', 'forms', 'notifications'] },
  { id: 'where', title: 'Where it is available', icon: 'phone', blurb: 'The phone lines and chats people reach it on', sections: ['channels', 'telephony'] },
  { id: 'records', title: 'Call records', icon: 'records', blurb: 'What is kept about each call, and for how long', sections: ['observability', 'post_call'] },
];
const COVERED = new Set(['persona', 'agents', 'messages', 'state', 'defaults', 'connections', 'tools', 'knowledge', 'forms', 'notifications', 'channels', 'telephony', 'observability', 'post_call']);
// Below the cards: the everyday parts, then the ones for engineers and operators. Nothing is left out; each opens in All settings.
const MORE = [['guardrails', 'Safety rules'], ['schedules', 'Business hours'], ['tasks', 'Multi-step tasks'], ['wrapups', 'Closing messages'], ['events', 'Events'], ['tests', 'Test scenarios'], ['meta', 'Name, tags and owner']];
const ADVANCED = [['identity', 'Caller identity'], ['constants', 'Fixed values'], ['runtime', 'Engine'], ['builder', 'Studio notes']];
const OPEN_KEY = 'weave_simple_open';
const CONNECTION_KIND = { http: 'Web service', mcp: 'Tool server', notifier: 'Text or email' };

const words = (text) => (String(text || '').trim().match(/\S+/g) || []).length;

function Card({ card, summary, errors, open, onToggle, children, detail, onDetail, detailLabel }) {
  const bodyId = `sm-body-${card.id}`;
  return (
    <section className={`smCard ${open ? 'open' : ''}`} data-card={card.id} aria-labelledby={`sm-title-${card.id}`}>
      <h3 id={`sm-title-${card.id}`}>
        <button type="button" className="smHead" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span className="smIcon" aria-hidden="true"><Icon name={card.icon} size={18} /></span>
          <span className="smTitle"><strong>{card.title}</strong><small>{open ? card.blurb : summary || card.blurb}</small></span>
          {errors > 0 && <b className="stFBadge" title={`${errors} problem${errors === 1 ? '' : 's'} to fix in this part`}>{errors}</b>}
          <i className="smChevron" aria-hidden="true">{open ? '▾' : '▸'}</i>
        </button>
      </h3>
      {open && (
        <div className="smBody" id={bodyId}>
          {children}
          <div className="smMore">
            <button type="button" className="stLink" aria-expanded={detail} onClick={onDetail}>{detail ? 'Hide detailed settings' : detailLabel || 'Detailed settings'}</button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---- Instructions
function InstructionsCard({ config, set, onChangeModel }) {
  const read = readSimple(config);
  const scope = templateScope(config);
  return (
    <div className="smFields">
      <label className="smField"><span>Name</span>
        <input className="stFInput" type="text" value={read.name} onChange={(event) => set(setAgentName(config, event.target.value))} aria-label="Agent name" />
        <small>What people see in lists. It also speaks as this, unless you set another name in the detailed settings.</small>
      </label>
      <div className="smField"><span id="sm-role-label">What should it do?</span>
        <TemplateField ariaLabel="What the agent should do (its role)" value={read.role} onChange={(text) => set(setRole(config, text))} scope={scope} multiline rows={6} mono={false} showCount />
        <small>Written to the agent, as you would brief a person: who it helps, what it does, what it must not do. This is what the agent that answers first is told.</small>
      </div>
      <label className="smField"><span>What it says first</span>
        <input className="stFInput" type="text" value={read.greeting} disabled={read.greetingChannels === 0} onChange={(event) => set(setGreeting(config, event.target.value))} aria-label="Greeting" />
        <small>{read.greetingChannels === 0 ? 'No channel has a greeting yet: add one in the detailed settings.' : read.greetingIsReference ? 'This greeting is one of the agent’s messages; changing it changes that message.' : `Used on ${read.greetingChannels} channel${read.greetingChannels === 1 ? '' : 's'}.`}</small>
      </label>
      <label className="smField"><span>Tone</span>
        <input className="stFInput" type="text" value={read.tone} placeholder="e.g. warm, concise, plain language" onChange={(event) => set(setTone(config, event.target.value))} aria-label="Tone" />
      </label>
      <div className="smField"><span>Style rules</span>
        <StringList values={read.styleRules} onChange={(list) => set(setStyleRules(config, list))} placeholder="e.g. One question at a time." addLabel="Add a rule" />
        <small>Short rules about how it talks. Rules about what it may do belong in the role.</small>
      </div>
      <p className="smNote" data-note="processing">{readDataFlow(config).sentence} <button type="button" className="stLink" onClick={onChangeModel}>Change</button></p>
      {read.agentId && <PromptPreview agentId={read.agentId} config={config} />}
    </div>
  );
}

// ---- Voice & Language
function VoiceCard({ config, set }) {
  const read = readSimple(config);
  const models = readModels(config);
  const [gender, setGender] = useVoiceGender(models.tts.provider, models.tts.voiceId);
  const voices = voicesFor(models.tts.provider, gender);
  const inList = voices.some((v) => v.voiceId === models.tts.voiceId);
  const spoken = new Set(read.speaks.map((c) => c.split('-')[0]));
  const primaryBase = read.primaryLanguage.split('-')[0];
  return (
    <div className="smFields">
      <div className="smPair">
        <label className="smField"><span>Main language</span>
          <SmartSelect value={read.primaryLanguage} ariaLabel="Main language" placeholder="Choose…" onChange={(code) => set(setPrimaryLanguage(config, code))}
            options={[...(read.primaryLanguage && !LANGUAGES.some(([c]) => c === read.primaryLanguage) ? [{ value: read.primaryLanguage, label: `${languageName(read.primaryLanguage)} (${read.primaryLanguage})` }] : []), ...LANGUAGES.map(([code, label]) => ({ value: code, label }))]} />
        </label>
        <fieldset className="smField smChecks"><legend>It also speaks</legend>
          <div className="smChipChecks">
            {BASE_LANGUAGES.map((language) => (
              <label key={language.code} className={spoken.has(language.code) ? 'on' : ''}>
                <input type="checkbox" checked={spoken.has(language.code)} disabled={language.code === primaryBase} onChange={(event) => set(toggleSpoken(config, language.code, event.target.checked))} aria-label={language.name} />
                {language.name}
              </label>
            ))}
          </div>
          <small>The main language is always on. Fixed lines (the greeting, the goodbye) need a text in each language: see Messages in the detailed settings.</small>
        </fieldset>
      </div>

      <div className="smField"><span>Voice</span>
        {!models.tts.provider ? <p className="smNote">No voice engine is chosen yet. Choose one under AI model.</p> : (
          <>
            <p className="smNote">Voice engine: <strong>{providerLabel(models.tts.provider)}</strong>{models.tts.model ? ` · ${models.tts.model}` : ''}. Change it under AI model.</p>
            {voicesFor(models.tts.provider).length > 0 ? (
              <>
                <GenderToggle provider={models.tts.provider} value={gender} onChange={setGender} />
                <select className="stFInput" value={inList ? models.tts.voiceId : ''} onChange={(event) => set(setVoiceId(config, event.target.value))} aria-label="Voice">
                  {!inList && <option value="">{models.tts.voiceId && !voicesFor(models.tts.provider).some((v) => v.voiceId === models.tts.voiceId) ? `Custom voice (${models.tts.voiceId})` : `Choose a ${gender.toLowerCase()} voice…`}</option>}
                  {voices.map((voice) => <option key={voice.id} value={voice.voiceId}>{voice.name} · {voice.language} · {voice.style}</option>)}
                </select>
              </>
            ) : <p className="smNote">There is no voice list for this engine here: type the voice id below.</p>}
            <input className="stFInput mono" type="text" spellCheck={false} value={models.tts.voiceId} placeholder="Voice id from your provider" onChange={(event) => set(setVoiceId(config, event.target.value))} aria-label="Voice id" />
          </>
        )}
      </div>

    </div>
  );
}

// ---- AI model
function ModelRow({ stage, config, set, providers }) {
  const slot = readModels(config)[stage.id];
  const offered = providersForStage(providers, stage.id);
  const current = providers.find((p) => p.name === slot.provider);
  const status = slot.provider ? modelStatus(stage.id, slot.provider, slot.model) : null;
  const runnable = !slot.provider || (current && current.installed !== false && (current.stages || []).includes(stage.id));
  return (
    <div className="smModelRow" data-stage={stage.id}>
      <div className="smModelHead"><strong>{stage.short}</strong><small>{stage.id === 'llm' ? 'Decides what to say and which tool to use' : stage.id === 'stt' ? 'Turns the caller’s speech into text' : 'Turns the reply into speech'}</small></div>
      <div className="smPair">
        <SmartSelect value={slot.provider} ariaLabel={`${stage.short} provider`} placeholder="Choose a provider…" onChange={(name) => set(setProvider(config, stage.id, name, providers))}
          options={[...(slot.provider && !offered.some((p) => p.name === slot.provider) ? [{ value: slot.provider, label: `${providerLabel(slot.provider)} (not offered here)` }] : []), ...offered.map((p) => ({ value: p.name, label: `${providerLabel(p.name)}${p.installed === false ? ' (not installed on the server)' : ''}`, disabled: p.installed === false }))]} />
        <SuggestInput value={slot.model} onChange={(text) => set(setModel(config, stage.id, text))} disabled={!slot.provider} placeholder="Choose a model or type its id" ariaLabel={`${stage.short} model`}
          options={modelsFor(stage.id, slot.provider).map((m) => ({ value: m.id, label: isRecommendedModel(stage.id, slot.provider, m.id) ? `${m.label} · Recommended` : m.label, description: [m.id !== m.label ? m.id : '', m.note].filter(Boolean).join(' · ') }))}
          footer="Or type any other model id: the server doesn’t check them." />
      </div>
      {!runnable && <p className="stFErr">The runtime can’t run “{slot.provider}” for this. Choose one from the list.</p>}
      {status && <small className={`smStatus ${status.state}`}>{status.text}</small>}
      {current && current.default_secret && current.key_available === false && <small className="smStatus custom">The server doesn’t have {current.default_secret} set, so a call would fail to start until it does.</small>}
    </div>
  );
}

function ModelCard({ config, set, providers, live }) {
  return (
    <div className="smFields">
      {!live && <p className="smNote">The server’s list of what it can run couldn’t be read, so these are the usual choices.</p>}
      {STAGES.map((stage) => <ModelRow key={stage.id} stage={stage} config={config} set={set} providers={providers} />)}
      <small className="smNote">Models come from a catalogue kept in the studio, not a live check. Typing any other model id is fine; the server doesn’t check them.</small>
    </div>
  );
}

// ---- Connections
function ConnectionsCard({ config, set, secrets, providers }) {
  const connections = readConnections(config);
  const tools = readTools(config);
  const [adding, setAdding] = useState(false);
  const [answers, setAnswers] = useState({ name: '', base_url: '' });
  const [tried, setTried] = useState(false);
  const problems = createProblems('http_connections', answers, config);
  const submit = (event) => {
    event.preventDefault();
    setTried(true);
    if (Object.keys(problems).length) return;
    set(createAndPoint(config, 'http_connections', answers).config);
    setAnswers({ name: '', base_url: '' }); setTried(false); setAdding(false);
  };
  return (
    <div className="smFields">
      <div className="smField"><span>Connections</span>
        {connections.length === 0 ? <p className="smNote">None yet. A connection is a web service the agent’s tools call, such as your billing system.</p> : (
          <ul className="smList">{connections.map((c) => <li key={c.id}><strong>{c.id}</strong><em>{CONNECTION_KIND[c.type] || c.type}</em><span>{c.detail || 'no address'}</span></li>)}</ul>
        )}
        {adding ? (
          <form className="smAdd" onSubmit={submit} noValidate aria-label="New HTTP connection">
            <label><span>Name</span><input className="stFInput small mono" type="text" value={answers.name} placeholder="billing_api" onChange={(event) => setAnswers({ ...answers, name: event.target.value })} aria-label="Connection name" aria-invalid={tried && !!problems.name || undefined} />{tried && problems.name && <small className="stFErr">{problems.name}</small>}</label>
            <label><span>Base address</span><input className="stFInput small mono" type="text" value={answers.base_url} placeholder="https://api.example.com" onChange={(event) => setAnswers({ ...answers, base_url: event.target.value })} aria-label="Connection base address" aria-invalid={tried && !!problems.base_url || undefined} />{tried && problems.base_url && <small className="stFErr">{problems.base_url}</small>}</label>
            <div className="smAddActions"><button type="submit" className="primaryCta compactCta">Add the connection</button><button type="button" className="quietButton" onClick={() => { setAdding(false); setTried(false); }}>Cancel</button></div>
          </form>
        ) : <button type="button" className="stAddBtn" onClick={() => setAdding(true)}>＋ Add an HTTP connection</button>}
      </div>

      <div className="smField"><span>Tools it can use</span>
        {tools.length === 0 ? <p className="smNote">No tools yet. Tools let the agent do things: end the call, hand over to a person, look something up.</p> : (
          <ul className="smChips" aria-label="Tools">{tools.map((t) => <li key={t.id} className={t.used ? '' : 'off'} title={t.description || undefined}>{t.id}<small>{plainToolKind({ type: t.kind, builtin: t.builtin })}{t.used ? '' : ' · not offered to an agent'}</small></li>)}</ul>
        )}
        <small>Add or change tools in the detailed settings.</small>
      </div>

      <div className="smField"><span>Secrets it needs</span>
        {secrets.length === 0 ? <p className="smNote">None. Credentials are never typed into a configuration: it holds only the name of each secret.</p> : (
          <ul className="smChips" aria-label="Secrets">{secrets.map((name) => {
            const owner = providers.find((p) => p.default_secret === name);
            return <li key={name} className={owner && owner.key_available === false ? 'off' : ''}><code>{name}</code><small>{owner ? (owner.key_available ? 'set on the server' : 'not set on the server') : 'checked when you deploy'}</small></li>;
          })}</ul>
        )}
        <small>Values live on the server and can’t be set from here. Only the names show.</small>
      </div>
    </div>
  );
}

function ElseLink({ id, label, count, onOpenAll }) {
  return <button type="button" className="quietButton" data-more={id} onClick={() => onOpenAll([id])}>{label}{count > 0 && <b className="stFBadge">{count}</b>}</button>;
}

export default function SimpleConfig({ editor, onOpenAll, onShowJson, onOpenJson, initialOpen }) {
  const config = editor.parsed.value;
  const { providers, live } = useProviders();
  const [open, setOpen] = useState(() => {
    try { const saved = JSON.parse(localStorage.getItem(OPEN_KEY) || 'null'); if (Array.isArray(saved) && !initialOpen) return new Set(saved); } catch { /* use the default */ }
    return new Set(initialOpen ? [initialOpen] : ['instructions']);
  });
  const [detail, setDetail] = useState(() => new Set(initialOpen === 'model' ? ['model'] : []));
  const toggle = (set, setter, id, persist) => setter((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); if (persist) { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...next])); } catch { /* storage unavailable */ } } return next; });

  const issues = useMemo(() => groupIssues(editor.report).filter((i) => i.severity === 'error' && i.path), [editor.report]);
  const errorsIn = (sections) => issues.filter((i) => sections.includes(i.path[0])).length;
  const secrets = useMemo(() => [...new Set([...collectSecretNames(config), ...(editor.report?.secrets_required || [])])].sort(), [config, editor.report]);

  if (editor.parsed.error || !config || typeof config !== 'object') {
    return <Notice kind="warn" title="The JSON needs fixing first" actions={<button type="button" className="quietButton" onClick={onShowJson}>Open the JSON</button>}>The simple view reads the draft, which isn’t valid JSON right now.</Notice>;
  }
  const set = (next) => { if (next !== config) editor.setValue(next); };
  const read = readSimple(config);
  const models = readModels(config);
  const summaries = {
    instructions: `${read.name || 'Unnamed'} · ${words(read.role)} word${words(read.role) === 1 ? '' : 's'} of instructions${read.tone ? ` · ${read.tone}` : ''}`,
    voice: [read.primaryLanguage ? languageName(read.primaryLanguage) : 'No language set', models.tts.voiceId ? (voicesFor(models.tts.provider).find((v) => v.voiceId === models.tts.voiceId)?.name || 'custom voice') : 'no voice chosen'].join(' · '),
    where: [read.channels.map((c) => `${c.name}${c.enabled ? '' : ' (off)'}`).join(', ') || 'No channels yet', `${(config.telephony?.transfers || []).length} transfer${(config.telephony?.transfers || []).length === 1 ? '' : 's'}`].join(' · '),
    records: describeRecords(config).headline,
    model: STAGES.map((stage) => { const slot = models[stage.id]; return slot.provider ? `${stage.id.toUpperCase()}: ${providerLabel(slot.provider)}${slot.model ? ` ${slot.model}` : ''}` : `${stage.id.toUpperCase()}: none`; }).join(' · '),
    connections: `${readConnections(config).length} connection${readConnections(config).length === 1 ? '' : 's'} · ${readTools(config).length} tool${readTools(config).length === 1 ? '' : 's'} · ${secrets.length} secret${secrets.length === 1 ? '' : 's'}`,
  };
  const detailBody = (card) => (card.id === 'model'
    ? <ModelsEditor editor={editor} onShowJson={onShowJson} />
    : <Suspense fallback={<Spinner label="Loading the settings" />}><FormEditor editor={editor} only={card.sections} embedded onShowJson={onShowJson} onOpenJson={onOpenJson} /></Suspense>);

  return (
    <div className="smView">
      {CARDS.map((card) => (
        <Card key={card.id} card={card} summary={summaries[card.id]} open={open.has(card.id)} errors={card.id === 'model' ? issues.filter((i) => i.path[0] === 'defaults' && i.path[1] === 'models').length : errorsIn(card.sections)}
          onToggle={() => toggle(open, setOpen, card.id, true)} detail={detail.has(card.id)} onDetail={() => toggle(detail, setDetail, card.id)} detailLabel={card.id === 'model' ? 'All model settings' : undefined}>
          {card.id === 'instructions' && <InstructionsCard config={config} set={set} onChangeModel={() => setOpen((old) => new Set([...old, 'model']))} />}
          {card.id === 'voice' && <VoiceCard config={config} set={set} />}
          {card.id === 'model' && <ModelCard config={config} set={set} providers={providers} live={live} />}
          {card.id === 'connections' && <ConnectionsCard config={config} set={set} secrets={secrets} providers={providers} />}
          {card.id === 'where' && <WhereCard config={config} set={set} />}
          {card.id === 'records' && <RecordsCard config={config} set={set} />}
          {detail.has(card.id) && <div className="smDetail" data-detail={card.id}>{detailBody(card)}</div>}
        </Card>
      ))}

      <section className="smElse" aria-label="More">
        <h3>More</h3>
        <p>The parts used less often. Each opens in All settings.</p>
        <div className="smElseLinks">
          {MORE.filter(([key]) => !COVERED.has(key)).map(([key, label]) => <ElseLink key={key} id={key} label={label} count={issues.filter((i) => i.path[0] === key).length} onOpenAll={onOpenAll} />)}
        </div>
        <details className="smAdvanced">
          <summary>Advanced</summary>
          <p>For engineers and the people who run the servers. Most agents never need these.</p>
          <div className="smElseLinks">
            {ADVANCED.filter(([key]) => !COVERED.has(key)).map(([key, label]) => <ElseLink key={key} id={key} label={label} count={issues.filter((i) => i.path[0] === key).length} onOpenAll={onOpenAll} />)}
          </div>
        </details>
      </section>
    </div>
  );
}
