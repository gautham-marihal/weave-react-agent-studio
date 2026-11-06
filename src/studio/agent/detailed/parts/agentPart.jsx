import React, { useMemo, useRef, useState } from 'react';
import Icon from '../../../../ui/Icon.jsx';
import { Input, TextArea } from '../../../../ui/Input.tsx';
import TemplateField from '../../../form/TemplateField.jsx';
import { templateScope } from '../../../form/templates.ts';
import { readDataFlow } from '../../../records/recordsModel.js';
import {
  BASE_LANGUAGES,
  LANGUAGES,
  greetingOf,
  greetingTarget,
  languageName,
  readSimple,
  setAgentName,
  setGreeting,
  setPersonaField,
  setPrimaryLanguage,
  setRole,
  setStyleRules,
  setTone,
  shareGreeting,
  toggleSpoken,
} from '../../../simple/simpleModel.js';
import { setLanguageField, spokenChips } from '../../pickers/pickerLogic.js';
import VoicePicker from '../../pickers/VoicePicker.jsx';
import ModelPicker from '../../pickers/ModelPicker.jsx';
import { modelLabel, providerLabel } from '../../../models/catalog.js';
import { summarizeModels, voicesFor, readModels } from '../../../models/config.js';
import { useProviders } from '../../../models/useProviders.js';
import { getAtPath } from '../../schemaPath.js';
import { InlineItems, briefOf } from '../Detailed.jsx';
import { speaks } from '../agentProfile/speaks.js';
import AgentWorkspace from '../agentProfile/AgentWorkspace.jsx';

const list = (v) => (Array.isArray(v) ? v : []);
// it speaks: a voice channel is on, or a channel hears or speaks audio (agentProfile/speaks.js)
export { speaks };
const inWords = (names) => {
  const each = [...new Set(names)];
  return each.length > 1 ? `${each.slice(0, -1).join(', ')} and ${each.at(-1)}` : each[0] || '';
};

// ---- the rows that need more than a box ----------------------------------------------------------------------------

// The agent's name. After a rename, the greeting, the name it introduces itself by and its instructions may still say
// the old name: offered once the box is left, never changed unasked.
function NameField({ config, set, id }) {
  const read = readSimple(config);
  const atFocus = useRef('');
  const [renamed, setRenamed] = useState(null);
  const persona = config?.persona && typeof config.persona === 'object' ? config.persona : {};
  const greeting = greetingOf(config);
  const has = (text, name) => !!name && typeof text === 'string' && text.includes(name);
  const swap = (text, from, to) => text.split(from).join(to);
  const stale = renamed
    ? [
        has(greeting.text, renamed.from) && {
          words: 'what it says first',
          change: (c) => setGreeting(c, swap(greeting.text, renamed.from, renamed.to), greetingTarget(c)),
        },
        typeof persona.name === 'string' &&
          persona.name.trim() === renamed.from && { words: 'the name it introduces itself by', change: (c) => setPersonaField(c, 'name', renamed.to) },
        has(read.role, renamed.from) && { words: 'its instructions', plural: true, change: (c) => setRole(c, swap(read.role, renamed.from, renamed.to)) },
      ].filter(Boolean)
    : [];
  return (
    <>
      <Input
        id={id}
        type="text"
        value={read.name}
        onFocus={() => {
          atFocus.current = read.name;
        }}
        onChange={(event) => set(setAgentName(config, event.target.value))}
        onBlur={() => {
          const from = atFocus.current.trim();
          const to = read.name.trim();
          setRenamed(from && to && from !== to ? { from, to } : null);
        }}
      />
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
    </>
  );
}

// What the agent that answers first should do: its brief, with details to insert, and the prompt it makes.
function RoleField({ config, set, id }) {
  const read = readSimple(config);
  const scope = useMemo(() => templateScope(config), [config]);
  return (
    <>
      <TemplateField
        id={id}
        ariaLabel="What the agent should do (its role)"
        value={read.role}
        placeholder="For example: You help Acme Dental’s patients book, move and cancel appointments. Ask one question at a time. You never give medical advice: offer to pass them to a person instead."
        onChange={(text) => set(setRole(config, text))}
        scope={scope}
        multiline
        rows={6}
        mono={false}
        showCount
        plain
      />
      <small className="dtNote">{readDataFlow(config).sentence}</small>
    </>
  );
}

// The line every channel says first. The channels it writes to are fixed at its first change this visit, so emptying
// and retyping keeps them, and a channel with its own line is never overwritten.
function GreetingField({ config, set, id }) {
  const [target, setTarget] = useState(null);
  const read = readSimple(config);
  const greeting = greetingOf(config, target);
  const others = greeting.others.map((o) => o.name);
  return (
    <>
      <TextArea
        id={id}
        rows={2}
        value={greeting.text}
        disabled={read.channels.length === 0}
        placeholder="Hello! How can I help you today?"
        onChange={(event) => {
          const to = target || greetingTarget(config);
          if (!target) setTarget(to);
          set(setGreeting(config, event.target.value, to));
        }}
      />
      {read.channels.length === 0 && (
        <small className="dtNote">Add a channel first (Channels): the greeting is what a channel says when someone arrives.</small>
      )}
      {greeting.text && others.length > 0 && (
        <small className="dtNote">
          {inWords(others)} {others.length === 1 ? 'says' : 'say'} something else.{' '}
          <button
            type="button"
            className="linkButton"
            onClick={() => {
              set(shareGreeting(config, target));
              setTarget(null);
            }}
          >
            Say this on {inWords(others)} too
          </button>
        </small>
      )}
    </>
  );
}

// A picker shown as a select-like button; the full picker opens under it.
// startOpen: the list shows at once (inside the profile's editor for that one setting)
function PickerButton({ id, value, empty, children, startOpen = false }) {
  const [open, setOpen] = useState(!!startOpen);
  // in a popover for that one setting, the picker is the editor itself (its choice is shown once, ticked in its list)
  if (startOpen)
    return (
      <div id={id} className="dtPickPanel bare" role="group" aria-labelledby={`${id}-label`}>
        {children}
      </div>
    );
  return (
    <>
      <button type="button" id={id} className="dtPickBtn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={value ? '' : 'dtPickEmpty'}>{value || empty}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} />
      </button>
      {open && <div className="dtPickPanel">{children}</div>}
    </>
  );
}

function VoiceRow({ config, set, id, pickersOpen }) {
  const models = readModels(config);
  const voice = voicesFor(models.tts.provider).find((v) => v.voiceId === models.tts.voiceId);
  const value = models.tts.voiceId ? `${voice?.name || 'Custom voice'}${models.tts.provider ? ` · ${providerLabel(models.tts.provider)}` : ''}` : '';
  const talks = readSimple(config).voiceChannel;
  return (
    <PickerButton id={id} value={value} empty={talks ? 'No voice chosen yet' : 'Not needed while it only chats'} startOpen={pickersOpen}>
      <VoicePicker config={config} set={set} speech={talks} bare={pickersOpen} />
    </PickerButton>
  );
}

// One stage's model ("Language model: OpenAI GPT-4.1 Mini"); its picker shows that stage only.
function ModelRow({ config, set, id, stage, pickersOpen }) {
  const { providers, live } = useProviders();
  const m = summarizeModels(config).find((s) => s.stage === stage);
  const value = m?.set ? `${m.providerName}${m.modelName ? ` · ${m.modelName}` : ''}` : '';
  return (
    <PickerButton id={id} value={value} empty="Not chosen yet" startOpen={pickersOpen}>
      <ModelPicker config={config} set={set} providers={providers} live={live} speech={readSimple(config).voiceChannel} stages={[stage]} bare={pickersOpen} />
    </PickerButton>
  );
}

// Speech-to-speech: the same picker, showing only its own part ("Not used" until one is chosen).
function RealtimeRow({ config, set, id, pickersOpen }) {
  const { providers, live } = useProviders();
  const { provider, model } = readModels(config).realtime;
  const value = provider ? `${providerLabel(provider)}${model ? ` · ${modelLabel('realtime', provider, model)}` : ''}` : '';
  return (
    <PickerButton id={id} value={value} empty="Not used" startOpen={pickersOpen}>
      <ModelPicker config={config} set={set} providers={providers} live={live} stages={['realtime']} />
    </PickerButton>
  );
}

// ---- the part --------------------------------------------------------------------------------------------------------

const speaksOf = (config) =>
  spokenChips({ primary: getAtPath(config, ['defaults', 'language', 'primary']) || '', speaks: list(getAtPath(config, ['defaults', 'language', 'speaks'])) })
    .filter((chip) => !chip.main)
    .map((chip) => chip.code);
const languageChoices = BASE_LANGUAGES.map((l) => ({ value: l.code, label: l.name }));

// Every setting of the part, as cards of rows: what All settings shows, and the rows the profile opens.
export const agentForm = {
  id: 'agent',
  num: '1',
  title: 'Agent',
  question: 'Who it is, what it should do, what it says first, and how it sounds.',
  cols: [
    [
      {
        id: 'name',
        title: 'Name and introduction',
        lead: 'How it is listed, and how it introduces itself to callers.',
        rows: [
          { id: 'name', label: 'Agent name', hint: 'Shown in your list of agents', tags: 'r', errPath: ['meta', 'name'], render: (c) => <NameField {...c} /> },
          {
            id: 'persona',
            label: 'Introduces itself as',
            hint: 'The name callers hear',
            path: ['persona', 'name'],
            put: (c, v) => setPersonaField(c, 'name', v ?? ''),
          },
          { id: 'company', label: 'Company name', path: ['persona', 'company'], put: (c, v) => setPersonaField(c, 'company', v ?? '') },
          { id: 'description', label: 'Description', kind: 'long', tags: 'm', path: ['meta', 'description'], rows: 2 },
          { id: 'tags', label: 'Tags', tags: 'm', path: ['meta', 'tags'] },
          { id: 'owner', label: 'Owner', tags: 'm', path: ['meta', 'owner'] },
        ],
      },
      {
        id: 'does',
        title: 'What it does',
        rows: [
          {
            id: 'role',
            label: 'Instructions',
            hint: 'Its role in plain words. Insert a detail to use something it knows.',
            tags: 'r',
            errPath: ['agents', 'items'],
            render: (c) => <RoleField {...c} />,
          },
          { id: 'shared', label: 'Rules for every agent', hint: 'Shared by all its subagents', path: ['persona', 'shared_rules'] },
        ],
      },
      {
        id: 'says',
        title: 'What it says',
        rows: [
          { id: 'greeting', label: 'Greeting', hint: 'Said first on every channel; a channel can have its own', render: (c) => <GreetingField {...c} /> },
          { id: 'tone', label: 'Tone', path: ['persona', 'tone'], placeholder: 'e.g. warm, concise, plain language', put: (c, v) => setTone(c, v ?? '') },
          {
            id: 'style',
            label: 'Style rules',
            path: ['persona', 'style_rules'],
            put: (c, v) => setStyleRules(c, v || []),
            placeholder: 'e.g. One question at a time.',
          },
          {
            id: 'lines',
            label: 'Fixed lines',
            hint: 'Exact sentences: text per language, can be interrupted or not',
            errPath: ['messages'],
            render: (c) => (
              <InlineItems ctx={c} id={c.id} path={['messages']} word="line" label="Fixed lines" collection="messages" nameOf={(m, i) => briefOf(m, i)} />
            ),
          },
        ],
      },
    ],
    [
      {
        id: 'voice',
        title: 'Voice and language',
        rows: [
          {
            id: 'voice',
            label: 'Voice',
            hint: 'Hear each one say the greeting',
            tags: (c) => (speaks(c) ? 'r' : ''),
            errPath: ['defaults', 'models', 'tts'],
            render: (c) => <VoiceRow {...c} />,
          },
          {
            id: 'primary',
            label: 'Main language',
            tags: 'r',
            kind: 'pick',
            path: ['defaults', 'language', 'primary'],
            options: LANGUAGES.map(([value, label]) => ({ value, label })),
            valueLabel: (v) => `${languageName(v)} (${v})`,
            put: (c, v) => setPrimaryLanguage(c, v),
          },
          {
            id: 'speaks',
            label: 'Also speaks',
            kind: 'pickchips',
            placeholder: '+ Add a language',
            options: languageChoices,
            get: speaksOf,
            put: (c, next) => {
              const now = speaksOf(c);
              const added = next.filter((code) => !now.includes(code));
              const removed = now.filter((code) => !next.includes(code));
              return [...added.map((code) => [code, true]), ...removed.map((code) => [code, false])].reduce(
                (acc, [code, on]) => toggleSpoken(acc, code, on),
                c,
              );
            },
          },
          {
            id: 'detect',
            label: 'Detect the caller’s language',
            path: ['defaults', 'language', 'auto_detect'],
            put: (c, v) => setLanguageField(c, 'auto_detect', v),
          },
          {
            id: 'understands',
            label: 'Also understands',
            hint: 'Recognised, answered in the main language',
            kind: 'pickchips',
            placeholder: '+ Add a language',
            options: languageChoices,
            path: ['defaults', 'language', 'also_understands'],
            put: (c, v) => setLanguageField(c, 'also_understands', v),
          },
          { id: 'speed', label: 'Speaking speed', tags: 'm', unit: '× (0.5 to 2)', path: ['defaults', 'models', 'tts', 'speed'] },
          { id: 'clean', label: 'Clean up text before speaking', tags: 'm', path: ['defaults', 'models', 'tts', 'text_transforms'] },
        ],
        adv: [
          {
            id: 'voiceid',
            label: 'A voice from your own account',
            hint: 'Its id at the voice provider. Or pick a voice in the list.',
            path: ['defaults', 'models', 'tts', 'voice_id'],
          },
          { id: 'sttlang', label: 'Language for listening', path: ['defaults', 'models', 'stt', 'language'] },
          { id: 'keyterms', label: 'Words to listen for', path: ['defaults', 'models', 'stt', 'keyterms'] },
        ],
      },
      {
        id: 'models',
        title: 'AI models',
        lead: 'What it thinks, hears and speaks with.',
        rows: [
          { id: 'llm', label: 'Thinking', tags: 'r', errPath: ['defaults', 'models', 'llm'], render: (c) => <ModelRow {...c} stage="llm" /> },
          { id: 'stt', label: 'Hearing', errPath: ['defaults', 'models', 'stt'], render: (c) => <ModelRow {...c} stage="stt" /> },
          { id: 'tts', label: 'Speaking', render: (c) => <ModelRow {...c} stage="tts" /> },
          { id: 'temperature', label: 'How creative the answers are', tags: 'm', unit: '0 to 2', path: ['defaults', 'models', 'llm', 'temperature'] },
          { id: 'tools', label: 'Can use tools', path: ['defaults', 'models', 'llm', 'tool_calling'] },
          { id: 'parallel', label: 'Use several tools at once', path: ['defaults', 'models', 'llm', 'parallel_tool_calls'] },
          { id: 'vision', label: 'Understands pictures', path: ['defaults', 'models', 'llm', 'vision'] },
        ],
        adv: [
          { id: 'fallbacks', label: 'Backup models', path: ['defaults', 'models', 'llm', 'fallbacks'] },
          {
            id: 'key',
            label: 'Key kept on the server',
            hint: 'The name of the key the server keeps for this service. The key itself is never shown here.',
            path: ['defaults', 'models', 'llm', 'api_key'],
          },
          {
            id: 'address',
            label: 'Web address of the service',
            hint: 'Only for a self-hosted or compatible service.',
            path: ['defaults', 'models', 'llm', 'base_url'],
          },
          { id: 'options', label: 'Provider settings', hint: 'Passed as they are to the provider.', path: ['defaults', 'models', 'llm', 'options'] },
          {
            id: 'realtime',
            label: 'Speech-to-speech model',
            errPath: ['defaults', 'models', 'realtime'],
            render: (c) => <RealtimeRow {...c} />,
          },
        ],
      },
    ],
  ],
};

// Build › Agent: the agent as a profile, or every setting at once (agentProfile/AgentWorkspace.jsx), both from agentForm.
export const agentPart = { ...agentForm, render: (ctx) => <AgentWorkspace ctx={ctx} form={agentForm} /> };
