import React, { useState } from 'react';
import { TextArea } from '../../../../ui/Input.tsx';
import Button from '../../../../ui/Button.tsx';
import Select from '../../../../ui/Select.tsx';
import { askConfirm } from '../../../../ui/dialogs.js';
import { useChannelTypes } from '../../../form/useChannelTypes.js';
import { CHANNEL_TYPES, ENTRY_LABELS, TYPE_LABELS, changeChannelType, modalityNotes } from '../../../form/presets.js';
import {
  canForms,
  canKeypad,
  entryFieldsFor,
  findVoiceOnly,
  infoOf,
  isVoiceChannel,
  mislabelledChat,
  plainSetting,
  stripVoiceOnly,
} from '../../../form/channelTypes.js';
import { addDefaultSpeechModels } from '../../../models/config.js';
import { useProviders } from '../../../models/useProviders.js';
import { REACH, reachOf, setReach } from '../../../setup/setupModel.js';
import { channelGreetingTarget, channelName, greetingOf, setGreeting } from '../../../simple/simpleModel.js';
import { SCHEDULES_START } from '../../pageLists.js';
import { getAtPath } from '../../schemaPath.js';
import { setPath } from '../schemaFacts.js';
import { DetailedPage, removeEntry } from '../Detailed.jsx';
import AddItem from '../AddItem.jsx';

// 6 · Channels and hours: where people reach the agent, and when. The three ways that work today are switched on and
// off with the setup's own switches (setupModel.js: a new one is made ready, the last one can't go); the kinds the
// server lists as not running yet are shown, waiting. Each channel opens its own card; hours and caller id sit beside.
// What a channel offers (a keypad, forms, which entry fields, voice) is the server's table of kinds (GET
// /channel-types, ctx.channelTypes), read through form/channelTypes.js as the channel form reads it.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// a phone line's routing is set up on Releases › Deploy, so these entry fields are never asked
const PLATFORM_ROUTE = ['dnis', 'sip_trunk', 'dispatch_rule'];

function ReachPills({ ctx, id }) {
  const { providers } = useProviders();
  const { types } = useChannelTypes();
  const [refused, setRefused] = useState('');
  const on = reachOf(ctx.config);
  const later = list(types).filter((t) => t && t.runsToday === false && !REACH.some((r) => r.type === t.type));
  const flip = (type) => {
    const result = setReach(ctx.config, type, !on[type], { providers, botId: ctx.botId, types });
    setRefused(result.refused || '');
    if (!result.refused) ctx.set(result.config);
  };
  return (
    <>
      <div className="dtPills" role="group" aria-label="Where people reach it" id={id}>
        {REACH.map((r) => (
          <button key={r.type} type="button" aria-pressed={on[r.type]} className={on[r.type] ? 'on' : ''} onClick={() => flip(r.type)}>
            {r.title || channelName(r.type)}
          </button>
        ))}
        {later.map((t) => (
          <button key={t.type} type="button" disabled aria-pressed="false">
            {channelName(t.type)} · soon
          </button>
        ))}
      </div>
      {refused && (
        <small className="stFieldError" role="alert">
          {refused}
        </small>
      )}
    </>
  );
}

// a channel's own first line: what this channel says when someone arrives (the agent's line, unless it has its own)
function OwnGreeting({ ctx, id, entry }) {
  const index = entry.base[1];
  const target = channelGreetingTarget(ctx.config, index);
  const line = greetingOf(ctx.config, target);
  return (
    <TextArea
      id={id}
      rows={2}
      value={line.text}
      placeholder="Empty: it waits for the person to start"
      onChange={(event) => ctx.set(setGreeting(ctx.config, event.target.value, target))}
    />
  );
}

// how callers reach a phone line: through numbers added on Releases › Deploy, nothing to fill in here
//   dialled: the numbers callers dial (null when the phone system isn't read, as in the demo)
function PhoneRoute({ id, dialled }) {
  const known = Array.isArray(dialled);
  return (
    <p className="dtNoteValue" id={id} data-route="platform">
      {known && (dialled.length ? `Callers dial ${dialled.join(', ')}. ` : 'No number yet, so it can’t be called. ')}
      Add one for this agent under Releases › Deploy: the phone line and the rule that routes calls to the agent are set up for you. There is nothing to fill in
      here.
    </p>
  );
}

const itemRow = (entry, key, row, when = () => true) => {
  const where = (config) => (entry && when(getAtPath(config, entry.base)) ? [...entry.base, ...key] : null);
  return {
    ...row,
    pathFor: where,
    disabled: (config) => !where(config),
    get: (config) => (where(config) ? getAtPath(config, where(config)) : undefined),
    put: (config, value) => (where(config) ? setPath(config, where(config), value === '' ? undefined : value) : config),
  };
};

// What a channel can do, each offered only where its kind can have it (a keypad needs a phone line, a form a screen);
// one set on a kind that can't have it stays, saying so, so it can be turned off. Unset, each is its kind's default.
const CAPABILITIES = [
  { key: 'dtmf', id: 'dtmf', label: 'Keypad tones', hint: 'Phone only', can: canKeypad, fallback: () => false, cannot: 'no keypad' },
  { key: 'human_transfer', id: 'person', label: 'Hand over to a person', can: () => true, fallback: () => true },
  { key: 'forms', id: 'forms', label: 'Show forms', hint: 'Web only', can: canForms, fallback: canForms, cannot: 'no screen to show a form on' },
];
const capabilityRows = (entry, types) => {
  const channel = isObj(entry.item) ? entry.item : {};
  const at = [...entry.base, 'capabilities'];
  return CAPABILITIES.filter((cap) => cap.can(types, channel.type) || channel.capabilities?.[cap.key] === true).map((cap) => ({
    id: cap.id,
    label: cap.label,
    hint: cap.hint,
    kind: 'sw',
    pathFor: () => [...at, cap.key],
    get: (config) => getAtPath(config, [...at, cap.key]) ?? cap.fallback(types, channel.type),
    put: (config, on) => setPath(config, [...at, cap.key], on),
    note: cap.can(types, channel.type)
      ? ''
      : `${infoOf(types, channel.type)?.label || 'This kind of channel'} has ${cap.cannot}, so this is refused when the agent is checked. Turn it off.`,
  }));
};

// The kind of channel, with what the server says of it; a change clears what doesn't apply to the new kind (asked first)
function KindPick({ ctx, id, entry }) {
  const types = ctx.channelTypes;
  const channel = isObj(entry.item) ? entry.item : {};
  const kind = infoOf(types, channel.type);
  const change = async (next) => {
    if (!next || next === channel.type) return;
    const { channel: made, cleared } = changeChannelType(channel, next, ctx.config?.meta?.id || '', types);
    if (
      cleared.length &&
      !(await askConfirm({
        title: `Change this channel to ${TYPE_LABELS[next] || next}?`,
        body: `These settings don’t apply to it and are cleared: ${cleared.map(plainSetting).join(', ')}.`,
        confirmLabel: 'Change channel',
      }))
    )
      return;
    ctx.set(setPath(ctx.config, entry.base, made));
  };
  return (
    <>
      <Select id={id} className="stFInput" value={channel.type ?? ''} onChange={(event) => change(event.target.value)}>
        {!CHANNEL_TYPES.includes(channel.type) && <option value={channel.type ?? ''}>{channel.type || 'Choose a kind…'}</option>}
        {CHANNEL_TYPES.map((type) => (
          <option key={type} value={type}>
            {TYPE_LABELS[type]}
            {infoOf(types, type)?.runsToday === false ? ' (not available yet)' : ''}
          </option>
        ))}
      </Select>
      {kind?.note && (
        <small className="dtNote" data-note="kind">
          {kind.note}
        </small>
      )}
    </>
  );
}

// What doesn't fit the channel, each with its one-click fix: a web chat that carries audio (really a web voice
// channel), voice-only settings on a channel with no voice (removed only when asked; Undo brings them back), and the
// speech models a voice channel needs.
function FitNotes({ ctx, entry, notes }) {
  const { providers } = useProviders();
  const channel = isObj(entry.item) ? entry.item : {};
  const makeVoice = () => {
    const { channel: made } = changeChannelType(channel, 'web_voice', ctx.config?.meta?.id || '', ctx.channelTypes);
    ctx.set(setPath(ctx.config, entry.base, made));
  };
  const removeVoiceOnly = () => {
    const { overrides, removed } = stripVoiceOnly(channel.overrides);
    if (!removed.length) return;
    const before = ctx.config;
    ctx.set(setPath(ctx.config, [...entry.base, 'overrides'], overrides));
    ctx.deleted?.(`The voice-only settings (${removed.map(plainSetting).join(', ')}) removed.`, before);
  };
  const addSpeech = () => {
    const { config: next, added } = addDefaultSpeechModels(ctx.config, providers);
    if (added.length) ctx.set(next);
  };
  const firstSpeech = notes.speech.find((note) => note.stage);
  return (
    <ul className="dtFit" aria-label="What does not fit this channel">
      {notes.mislabelled && (
        <li data-note="mislabelled">
          <span>This web chat carries audio, so it is really a web voice channel.</span>
          <Button type="button" size="small" variant="secondary" onClick={makeVoice}>
            Make it a web voice channel
          </Button>
        </li>
      )}
      {notes.voiceOnly.length > 0 && (
        <li data-note="voice-only">
          <span>
            {infoOf(ctx.channelTypes, channel.type)?.label || 'This kind of channel'} has no voice, so these settings do nothing here:{' '}
            {notes.voiceOnly.map(plainSetting).join(', ')}.
          </span>
          <Button type="button" size="small" variant="secondary" onClick={removeVoiceOnly}>
            Remove them
          </Button>
        </li>
      )}
      {notes.speech.map((note) => (
        <li key={note.text} data-note="needs">
          <span>{note.text}</span>
          {note === firstSpeech && (
            <Button type="button" size="small" variant="secondary" onClick={addSpeech}>
              Add default speech models
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
const fitOf = (entry, config, types) => {
  const channel = isObj(entry.item) ? entry.item : {};
  return {
    mislabelled: mislabelledChat(channel),
    voiceOnly: infoOf(types, channel.type) && !isVoiceChannel(channel, types) ? findVoiceOnly(channel.overrides) : [],
    speech: modalityNotes(channel, config).filter((note) => note.level === 'warn'),
  };
};

// The entry fields the kind has (a custom channel may have any: all the known ones); a phone line's routing is not asked
const entryKeys = (types, channel) => {
  const own = entryFieldsFor(types, channel?.type);
  return (own === null ? Object.keys(ENTRY_LABELS) : list(own)).filter((key) => !(channel?.type === 'sip_voice' && PLATFORM_ROUTE.includes(key)));
};

// The Channels part, with the server's table of kinds of channel
export function ChannelsPage({ extra = {}, ...props }) {
  const { types } = useChannelTypes();
  return <DetailedPage part={channelsPart} {...props} extra={{ ...extra, channelTypes: types }} />;
}

export const channelsPart = {
  id: 'channels',
  num: '6',
  title: 'Channels and hours',
  question: 'Where do people reach it, and when? Each channel opens its own settings; hours and caller id sit beside them.',
  cols: [
    [
      {
        id: 'reach',
        title: 'Where people reach it',
        rows: [
          {
            id: 'reach',
            label: 'Channels',
            hint: 'The last working channel can’t be switched off',
            errPath: ['channels'],
            render: (c) => <ReachPills ctx={c} id={c.id} />,
          },
        ],
      },
      {
        id: 'channel',
        title: 'Its channels',
        list: {
          id: 'channels',
          path: ['channels'],
          label: 'Settings for',
          hint: 'The channel whose settings are below',
          nameOf: (ch, i) => (isObj(ch) ? `${channelName(ch.type)}${ch.enabled === false ? ' (off)' : ''}` : `Channel ${i + 1}`),
          renderAdd: (c) => <AddItem ctx={c} path={['channels']} pickerKey="channels" word="channel" onAdded={(key) => c.choose('channels', key)} />,
        },
        of: 'channels',
        word: 'channel',
        titleFor: (entry, c) => (entry ? `A channel: ${channelName(getAtPath(c.config, [...entry.base, 'type']))}` : 'A channel'),
        remove: (c, entry) => removeEntry(c, 'channels', entry),
        rowsFor: (c) => {
          const entry = c.chosen('channels');
          if (!entry) return [];
          const types = c.channelTypes;
          const kind = infoOf(types, entry.item?.type);
          const fit = fitOf(entry, c.config, types);
          const speaks = (channel) => isObj(channel) && isVoiceChannel(channel, types);
          return [
            itemRow(entry, ['enabled'], { id: 'on', label: 'On', kind: 'sw' }),
            ...(kind && kind.runsToday === false
              ? [
                  {
                    id: 'notRunning',
                    label: 'Not available yet',
                    kind: 'note',
                    text: `Nothing connects ${kind.label} to the runtime yet, so this channel is saved but nobody can reach the agent through it.`,
                  },
                ]
              : []),
            ...(entry.item?.type === 'sip_voice'
              ? [{ id: 'route', label: 'How callers reach it', render: (ctx) => <PhoneRoute id={ctx.id} dialled={ctx.dialled} /> }]
              : []),
            {
              id: 'greeting',
              label: 'Its own greeting',
              hint: 'Empty: it uses the agent’s greeting',
              render: (ctx) => <OwnGreeting ctx={ctx} id={ctx.id} entry={entry} />,
            },
            itemRow(entry, ['greeting', 'allow_interruptions'], { id: 'interrupt', label: 'Callers can interrupt the greeting', kind: 'sw' }, speaks),
            ...capabilityRows(entry, types),
            itemRow(entry, ['instructions_append'], { id: 'extra', label: 'Extra instructions for this channel', kind: 'long', rows: 2 }),
            ...(fit.mislabelled || fit.voiceOnly.length || fit.speech.length
              ? [{ id: 'fit', label: 'Needs a look', render: (ctx) => <FitNotes ctx={ctx} entry={entry} notes={fit} /> }]
              : []),
          ];
        },
        advFor: (c) => {
          const entry = c.chosen('channels');
          if (!entry) return [];
          return [
            { id: 'type', label: 'Kind of channel', path: [...entry.base, 'type'], render: (ctx) => <KindPick ctx={ctx} id={ctx.id} entry={entry} /> },
            ...entryKeys(c.channelTypes, entry.item).map((key) =>
              itemRow(entry, ['entry', key], {
                id: `entry_${key}`,
                label: ENTRY_LABELS[key]?.[0] || key,
                kind: key === 'allowed_origins' ? 'list' : 'text',
                placeholder: ENTRY_LABELS[key]?.[2],
              }),
            ),
            itemRow(entry, ['match'], { id: 'match', label: 'Who it answers', kind: 'form' }),
            itemRow(entry, ['modalities'], { id: 'modalities', label: 'What it hears and says', kind: 'form' }),
            itemRow(entry, ['inputs'], { id: 'inputs', label: 'Pictures and video', kind: 'form' }),
            itemRow(entry, ['overrides'], { id: 'overrides', label: 'Its own models and conversation settings', kind: 'form' }),
          ];
        },
      },
    ],
    [
      {
        id: 'hours',
        title: 'Business hours',
        lead: 'Used by transfers and the “closed” message.',
        list: {
          id: 'schedules',
          path: ['schedules'],
          label: 'Schedules',
          empty: 'None yet. The first one starts as Monday to Friday, 9 to 5, in your time zone.',
          nameOf: (s, key) => (isObj(s) && s.description) || key,
          add: (config) => {
            if (!isObj(config?.schedules) || !Object.keys(config.schedules).length) {
              const next = SCHEDULES_START.make(config);
              return { config: next, key: Object.keys(next.schedules || {})[0] };
            }
            const key = `hours_${Object.keys(config.schedules).length + 1}`;
            return {
              config: setPath(config, ['schedules', key], {
                description: 'More hours',
                timezone: config.schedules[Object.keys(config.schedules)[0]]?.timezone || 'UTC',
                weekly: [],
              }),
              key,
            };
          },
        },
        of: 'schedules',
        word: 'schedule',
        remove: (c, entry) => removeEntry(c, 'schedules', entry),
        rowsFor: (c) => {
          const entry = c.chosen('schedules');
          if (!entry) return [];
          return [
            itemRow(entry, ['timezone'], { id: 'tz', label: 'Time zone', kind: 'text', placeholder: 'Asia/Singapore' }),
            itemRow(entry, ['weekly'], { id: 'week', label: 'Normal week', kind: 'form' }),
            itemRow(entry, ['holidays'], { id: 'closed', label: 'Closed days', kind: 'form' }),
            itemRow(entry, ['description'], { id: 'name', label: 'Name', kind: 'text' }),
          ];
        },
        advFor: (c) => {
          const entry = c.chosen('schedules');
          return entry ? [itemRow(entry, ['overrides'], { id: 'overrides', label: 'One-off changes by date', kind: 'form' })] : [];
        },
      },
      {
        id: 'caller',
        title: 'Who is calling',
        lead: 'How it knows the caller’s number, so tools can look them up.',
        rows: [
          { id: 'sources', label: 'Where the number comes from', kind: 'form', path: ['identity', 'caller_id', 'sources'] },
          {
            id: 'tidy',
            label: 'Tidy the number',
            kind: 'ch',
            options: [
              { value: 'e164', label: 'International format' },
              { value: 'none', label: 'Leave it as it is' },
            ],
            get: (config) => getAtPath(config, ['identity', 'caller_id', 'normalize', 'type']),
            put: (config, type) => {
              const now = getAtPath(config, ['identity', 'caller_id', 'normalize']);
              return setPath(
                config,
                ['identity', 'caller_id', 'normalize'],
                type === 'e164' ? { default_country: '', ...(isObj(now) ? now : {}), type } : { type },
              );
            },
          },
          {
            id: 'country',
            label: 'Default country',
            kind: 'text',
            placeholder: 'SG',
            disabled: (config) => getAtPath(config, ['identity', 'caller_id', 'normalize', 'type']) !== 'e164',
            path: ['identity', 'caller_id', 'normalize', 'default_country'],
          },
        ],
      },
    ],
  ],
};
