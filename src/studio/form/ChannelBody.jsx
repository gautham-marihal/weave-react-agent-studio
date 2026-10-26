import React from 'react';
import Fold from '../../ui/Fold.jsx';
import { isObj } from './engine.js';
import { keyOf, useConfigSelect, useForm } from './ctx.js';
import { StringList, Switch, TextInput } from './fields.jsx';
import { IdChip } from './IdTools.jsx';
import { useProviders } from '../models/useProviders.js';
import { addDefaultSpeechModels } from '../models/config.js';
import { providerLabel } from '../models/catalog.js';
import { ObjectBody } from './Node.jsx';
import { CHANNEL_TYPES, ENTRY_FIELDS, ENTRY_LABELS, TYPE_LABELS, changeChannelType, modalityNotes } from './presets.js';
import { TechKey } from './TechName.jsx';
import { askConfirm } from '../../ui/dialogs.js';
import { canForms, canKeypad, entryFieldsFor, findVoiceOnly, infoOf, isVoiceChannel, mislabelledChat, plainSetting, stripVoiceOnly } from './channelTypes.js';
import Select from '../../ui/Select.tsx';

// One channel, drawn for what it is: the type decides which fields are shown, so a phone line never offers a widget id
// and a web chat never offers a phone number. The id is a permanent key (Rename… rewrites everything that points at
// it). What a person changes comes first (on or off, what it can do, extra instructions); the rest (its id, its kind,
// how it is reached, what it can hear and say, exceptions and advanced settings) is folded under "Technical details",
// with a line that says what is in it. What it says first is asked on the Agent page; a voice channel keeps only
// whether the caller may talk over it.

const HANDLED = ['id', 'type', 'enabled', 'entry', 'capabilities'];
const REQUIRES_ENTRY = ['sip_voice', 'web_chat'];
// How a phone call reaches the agent is the platform's job (FRONTEND_GUIDE 8 and 10.5): adding a phone number for the
// agent and an environment sets up the trunk and the dispatch rule, so the number, the trunk and the rule are never
// asked for here. The runtime reads none of them. Values an older configuration noted are shown, and can be removed:
// they route nothing.
const PLATFORM_ROUTE = ['dnis', 'sip_trunk', 'dispatch_rule'];
const COLLAPSED = new Set(['match', 'inputs', 'overrides']);
// asked above the fold; what it says first is the Agent page's (and the switch for talking over it is drawn here)
const PLAIN_KEYS = ['instructions_append'];
const OWN_KEYS = ['greeting'];
// "text in and out", "voice in and out", "voice and text in, voice out"
const WORDS = { audio: 'voice', text: 'text', image: 'pictures', video: 'video' };
const together = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] || '');
function modalityWords(modalities) {
  const input = (Array.isArray(modalities?.input) ? modalities.input : []).map((m) => WORDS[m] || m);
  const output = (Array.isArray(modalities?.output) ? modalities.output : []).map((m) => WORDS[m] || m);
  if (!input.length && !output.length) return '';
  if (input.join() === output.join()) return `${together(input)} in and out`;
  return [input.length ? `${together(input)} in` : '', output.length ? `${together(output)} out` : ''].filter(Boolean).join(', ');
}

// What each capability means and what it is when nobody has said (the schema's own wording).
const CAPABILITIES = [
  {
    key: 'dtmf',
    label: 'Keypad tones (DTMF)',
    help: 'Callers can press keys and the agent can send tones. Only a phone line has a keypad.',
    fallback: () => false,
  },
  {
    key: 'human_transfer',
    label: 'Hand over to a person',
    help: 'Off: a transfer tool skips the transfer on this channel and runs its fallback straight away.',
    fallback: () => true,
  },
  {
    key: 'forms',
    label: 'Show forms',
    help: 'Can this channel show a form? Where it can’t, a form runs its “otherwise” actions instead.',
    fallback: (type) => type === 'web_chat' || type === 'web_voice',
  },
];

const sortByOrder = (obj, order) => {
  const rank = (key) => {
    const i = order.indexOf(key);
    return i === -1 ? order.length : i;
  };
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => rank(a) - rank(b)));
};

export default function ChannelBody({ shape, value, path, onChange, disabled }) {
  const ctx = useForm();
  const types = ctx.channelTypes;
  const obj = isObj(value) ? value : {};
  const type = obj.type;
  const kind = infoOf(types, type); // what this kind of channel may carry and offer (GET /channel-types)
  const botId = useConfigSelect((c) => c?.meta?.id || '');
  const notes = useConfigSelect((c) => modalityNotes(obj, c));
  const { providers } = useProviders();
  // A voice channel on an agent with no speech models: one click sets a default for each missing stage (from what the server can run)
  const firstSpeech = notes.findIndex((note) => note.stage); // the button goes under the first of the notes about speech, once
  const addSpeech = () => {
    const { config: next, added, skipped } = addDefaultSpeechModels(ctx.store.get(), providers);
    if (!added.length) return;
    ctx.applyConfig(
      next,
      `Added default speech models: ${added.map((a) => `${a.stage === 'stt' ? 'listening' : 'speaking'} with ${providerLabel(a.provider)}${a.keySet ? '' : ' (its key may not be set on the server)'}`).join(', ')}.${skipped.length ? ' No provider is available for the rest.' : ''}`,
    );
  };
  const order = Object.keys(shape.properties);
  const mislabelled = mislabelledChat(obj);
  // settings only a voice channel has, found on a channel that has no voice
  const voiceOnlySet = kind && !isVoiceChannel(obj, types) ? findVoiceOnly(obj.overrides) : [];

  const handled = Object.fromEntries(Object.entries(obj).filter(([key]) => HANDLED.includes(key)));
  const rest = Object.fromEntries(Object.entries(obj).filter(([key]) => !HANDLED.includes(key)));
  const restShape = {
    ...shape,
    properties: Object.fromEntries(Object.entries(shape.properties).filter(([key]) => !HANDLED.includes(key))),
    required: (shape.required || []).filter((key) => !HANDLED.includes(key)),
  };
  const set = (patch) => onChange(sortByOrder({ ...obj, ...patch }, order));

  // the settings only a voice channel has, on a channel that has no voice: removed on request (never behind the
  // author's back), and the Undo bar takes it back
  const removeVoiceOnly = () => {
    const { overrides, removed } = stripVoiceOnly(obj.overrides);
    if (!removed.length) return;
    ctx.markDelete(`the voice-only settings (${removed.map(plainSetting).join(', ')})`);
    const { overrides: _old, ...without } = obj;
    onChange(sortByOrder(overrides ? { ...without, overrides } : without, order));
  };

  const changeType = async (next) => {
    if (next === type) return;
    const { channel, cleared } = changeChannelType(obj, next, botId, types);
    if (
      cleared.length &&
      !(await askConfirm({
        title: `Change this channel to ${TYPE_LABELS[next] || next}?`,
        body: `These settings don’t apply to it and are cleared: ${cleared.map(plainSetting).join(', ')}.`,
        confirmLabel: 'Change channel',
      }))
    )
      return;
    onChange(sortByOrder(channel, order));
  };

  // ---- entry: only the fields that apply to this type
  const entry = isObj(obj.entry) ? obj.entry : {};
  // the kind's own entry fields; a custom channel may have any, so all the known ones are offered
  const applicable = kind ? (kind.entryFields === null ? Object.keys(ENTRY_LABELS) : entryFieldsFor(types, type)) : ENTRY_FIELDS[type];
  const setEntry = (key, v) => {
    const next = { ...entry };
    if (v === '' || (Array.isArray(v) && v.length === 0)) delete next[key];
    else next[key] = v;
    if (!Object.keys(next).length && !REQUIRES_ENTRY.includes(type)) {
      const { entry: _drop, ...without } = obj;
      onChange(sortByOrder(without, order));
      return;
    }
    set({ entry: next });
  };
  const stray = applicable ? Object.keys(entry).filter((key) => !applicable.includes(key)) : [];
  const phoneLine = type === 'sip_voice';
  const shown = (applicable || []).filter((key) => !(phoneLine && PLATFORM_ROUTE.includes(key)));
  const noted = phoneLine ? PLATFORM_ROUTE.filter((key) => entry[key] !== undefined && entry[key] !== '') : [];
  // fields left from another kind of channel: shown, so they can be deleted
  const strayRows = stray.map((key) => (
    <div className="stFRow wide" key={key}>
      <div className="stFLabel">
        <label>{key}</label>
        <span className="stFTag warn">doesn’t apply to {TYPE_LABELS[type] || type}</span>
        <button
          type="button"
          className="stFDel small"
          disabled={disabled}
          onClick={() => {
            ctx.markDelete(`entry.${key}`);
            const next = { ...entry };
            delete next[key];
            set({ entry: next });
          }}
        >
          Delete
        </button>
      </div>
      <code className="stFIdChip">{JSON.stringify(entry[key])}</code>
    </div>
  ));
  const removeNotes = () => {
    const next = { ...entry };
    noted.forEach((key) => {
      ctx.markDelete(`entry.${key}`);
      delete next[key];
    });
    set({ entry: next });
  };
  const entryControl = (key) => {
    const [label, help, example] = ENTRY_LABELS[key] || [key, '', ''];
    const id = `${path.join('-')}-${key}`;
    return (
      <div className="stFRow wide" key={key} data-path={`${path.join('.')}.entry.${key}`}>
        <div className="stFLabel">
          <label htmlFor={id}>{label}</label>
          {type === 'web_chat' && key === 'widget_id' && (
            <abbr title="Required" className="stFReq">
              *
            </abbr>
          )}
          <TechKey name={key} path={[...path, 'entry', key]} />
        </div>
        {key === 'allowed_origins' ? (
          <StringList values={Array.isArray(entry[key]) ? entry[key] : []} onChange={(v) => setEntry(key, v)} disabled={disabled} placeholder={example} />
        ) : (
          <TextInput id={id} value={entry[key] ?? ''} onChange={(v) => setEntry(key, v)} disabled={disabled} placeholder={example} />
        )}
        {help && <p className="stFHelp">{help}</p>}
      </div>
    );
  };

  const caps = isObj(obj.capabilities) ? obj.capabilities : {};
  // the folded part: what it holds in a line, and open when something in it needs fixing
  const techKeys = Object.keys(restShape.properties).filter((key) => !PLAIN_KEYS.includes(key) && !OWN_KEYS.includes(key));
  const techProblems = ['id', 'type', 'entry', ...techKeys].some((key) => ctx.issuesUnder(keyOf([...path, key])).length > 0);
  const route = phoneLine ? 'a number added when it goes live' : typeof entry.widget_id === 'string' && entry.widget_id ? `widget ${entry.widget_id}` : '';
  const techSummary = [TYPE_LABELS[type] || type, modalityWords(obj.modalities), route].filter(Boolean).join(' · ');
  // a voice channel that says something first: whether the caller may talk over it (unset, they may)
  const greeting = isObj(obj.greeting) ? obj.greeting : null;
  // (a channel that speaks: its first line is heard, so it can be talked over; one that only writes has nothing to interrupt)
  const speaks = Array.isArray(obj.modalities?.output) ? obj.modalities.output.includes('audio') : type === 'sip_voice' || type === 'web_voice';
  const interruptible = speaks && greeting && greeting.say !== undefined;
  const setInterrupt = (on) => set({ greeting: { ...greeting, allow_interruptions: on } });
  // a switch is offered only for what the kind of channel can have (the keypad needs a phone line, a form needs a screen)
  const unavailable = (cap) => !!kind && ((cap.key === 'dtmf' && !canKeypad(types, type)) || (cap.key === 'forms' && !canForms(types, type)));
  const setCap = (key, on) => set({ capabilities: { ...caps, [key]: on } });

  const technical = (
    <>
      <div className="stFGrid">
        {obj.id ? (
          <IdChip id={obj.id} disabled={disabled} onRename={() => ctx.requestRename('channels', obj.id)} />
        ) : (
          <div className="stFRow wide">
            <div className="stFLabel">
              <label>Id</label>
              <abbr title="Required" className="stFReq">
                *
              </abbr>
            </div>
            <TextInput value={obj.id ?? ''} onChange={(v) => set({ id: v })} disabled={disabled} placeholder="phone" />
          </div>
        )}
        <div className="stFRow">
          <div className="stFLabel">
            <label htmlFor={`${path.join('-')}-type`}>Kind of channel</label>
            <abbr title="Required" className="stFReq">
              *
            </abbr>
          </div>
          <Select
            id={`${path.join('-')}-type`}
            className="stFInput"
            value={type ?? ''}
            disabled={disabled}
            onChange={(event) => changeType(event.target.value)}
          >
            {!CHANNEL_TYPES.includes(type) && <option value={type ?? ''}>{type || 'Choose a kind…'}</option>}
            {CHANNEL_TYPES.map((item) => (
              <option key={item} value={item}>
                {TYPE_LABELS[item]}
                {infoOf(types, item)?.runsToday === false ? ' (not available yet)' : ''}
              </option>
            ))}
          </Select>
          <p className="stFHelp">Changing it clears the fields that only belong to the old kind (you are asked first).</p>
          {kind?.note && (
            <p className="stFHelp" data-note="kind">
              {kind.note}
            </p>
          )}
        </div>
      </div>

      {phoneLine && (
        <fieldset className="stChannelBlock" data-route="platform">
          <legend>How callers reach it</legend>
          <p className="stFHelp stChannelNote">
            Through a phone number. Add one for this agent under Releases › Deploy: you give the number and the environment, and the phone line (trunk) and the
            rule that routes calls to the agent are set up for you. There is nothing to fill in here.
          </p>
          {noted.length > 0 && (
            <div className="stRouteNotes" data-note="route-notes">
              <p className="stFHelp">
                This channel still notes {noted.length === 1 ? 'a value' : 'values'} from an older setup. {noted.length === 1 ? 'It is' : 'They are'} only a
                note: calls are not routed by {noted.length === 1 ? 'it' : 'them'}.
              </p>
              <dl>
                {noted.map((key) => (
                  <div key={key}>
                    <dt>{(ENTRY_LABELS[key] || [key])[0]}</dt>
                    <dd>
                      <code>{typeof entry[key] === 'string' ? entry[key] : JSON.stringify(entry[key])}</code>
                    </dd>
                  </div>
                ))}
              </dl>
              {!disabled && (
                <button type="button" className="stLink" onClick={removeNotes}>
                  Remove {noted.length === 1 ? 'this note' : 'these notes'}
                </button>
              )}
            </div>
          )}
          {strayRows}
        </fieldset>
      )}
      {!phoneLine && applicable && (applicable.length > 0 || stray.length > 0) && (
        <fieldset className="stChannelBlock">
          <legend>How it is reached</legend>
          <p className="stFHelp stChannelNote">
            For reference only. These fields describe the route and are not read by the runtime: a visitor reaches an agent through the session token for the
            widget. Nothing here connects it.
          </p>
          {shown.map(entryControl)}
          {strayRows}
        </fieldset>
      )}

      <ObjectBody
        shape={restShape}
        value={rest}
        path={path}
        disabled={disabled}
        collapsedKeys={COLLAPSED}
        onlyKeys={techKeys}
        onChange={(nextRest) => onChange(sortByOrder({ ...handled, ...nextRest }, order))}
      />
    </>
  );

  return (
    <div className="stFObject stChannel" data-channel-type={type}>
      <div className="stFGrid">
        <div className="stFRow toggle bare">
          <div className="stFLabel">
            <label>Enabled</label>
          </div>
          <Switch checked={obj.enabled !== false} onChange={(v) => set({ enabled: v })} disabled={disabled} label="Enabled" />
        </div>
      </div>
      {kind && !kind.runsToday && (
        <p className="stFWarn" role="note" data-note="not-running">
          Nothing connects {kind.label} to the runtime yet, so this channel is saved but nobody can reach the agent through it.
        </p>
      )}

      <fieldset className="stChannelBlock">
        <legend>What it can do</legend>
        <div className="stCaps">
          {CAPABILITIES.filter((cap) => !unavailable(cap) || caps[cap.key] === true).map((cap) => {
            const explicit = cap.key in caps;
            const refused = unavailable(cap); // set on, on a kind that cannot have it: shown so it can be turned off
            return (
              <div className="stCap" key={cap.key} data-capability={cap.key}>
                <strong className="stCapName" aria-hidden="true">
                  {cap.label}
                </strong>
                <Switch checked={explicit ? !!caps[cap.key] : cap.fallback(type)} onChange={(v) => setCap(cap.key, v)} disabled={disabled} label={cap.label} />
                <p className="stFHelp">
                  {cap.help}
                  {explicit ? '' : ' (using the default for this kind)'}
                </p>
                {refused && (
                  <p className="stFWarn" role="note">
                    {kind.label} has {cap.key === 'dtmf' ? 'no keypad' : 'no screen to show a form on'}, so this setting is refused when the agent is checked.
                    Turn it off.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      {interruptible && (
        <div className="stFRow toggle bare" data-path={`${path.join('.')}.greeting.allow_interruptions`}>
          <div className="stFLabel">
            <label>Let the caller interrupt the first line</label>
          </div>
          <Switch
            checked={greeting.allow_interruptions !== false}
            onChange={setInterrupt}
            disabled={disabled}
            label="Let the caller interrupt the first line"
          />
          <p className="stFHelp">
            Whether someone can talk over what it says first (set on the Agent page){'allow_interruptions' in greeting ? '' : ' (using the default)'}.
          </p>
        </div>
      )}

      <ObjectBody
        shape={restShape}
        value={rest}
        path={path}
        disabled={disabled}
        onlyKeys={PLAIN_KEYS}
        showUnknown={false}
        onChange={(nextRest) => onChange(sortByOrder({ ...handled, ...nextRest }, order))}
      />

      <Fold className="stFFold stChannelTech" open={techProblems}>
        <summary>
          Technical details
          {techSummary && <small>{techSummary}</small>}
        </summary>
        {technical}
      </Fold>

      {(mislabelled || voiceOnlySet.length > 0) && (
        <ul className="stChannelNotes" aria-label="What does not fit this channel">
          {mislabelled && (
            <li className="warn" data-note="mislabelled">
              <span>This web chat carries audio, so it is really a web voice channel. Draw it as one, or take the audio out.</span>
              {!disabled && (
                <button type="button" className="stAddBtn" onClick={() => changeType('web_voice')}>
                  Make it a web voice channel
                </button>
              )}
            </li>
          )}
          {voiceOnlySet.length > 0 && (
            <li className="warn" data-note="voice-only">
              <span>
                {kind?.label || 'This kind of channel'} has no voice, so these settings do nothing here: {voiceOnlySet.map(plainSetting).join(', ')}.
              </span>
              {!disabled && (
                <button type="button" className="stAddBtn" onClick={removeVoiceOnly}>
                  Remove them
                </button>
              )}
            </li>
          )}
        </ul>
      )}

      {notes.length > 0 && (
        <ul className="stChannelNotes" aria-label="What this channel needs">
          {notes.map((note, index) => (
            <li key={index} className={note.level}>
              <span>{note.text}</span>
              {note.fix === 'models' && ctx.openModels && (
                <button type="button" className="stLink" onClick={() => ctx.openModels()}>
                  Open Models
                </button>
              )}
              {index === firstSpeech && !disabled && (
                <button type="button" className="stAddBtn" onClick={addSpeech}>
                  Add default speech models
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
