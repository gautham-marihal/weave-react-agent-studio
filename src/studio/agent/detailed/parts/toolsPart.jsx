import React, { useSyncExternalStore } from 'react';
import Select from '../../../../ui/Select.tsx';
import { Input, TextArea } from '../../../../ui/Input.tsx';
import { NumberInput, Switch } from '../../../form/fields.jsx';
import ParamsEditor from '../../../form/ParamsEditor.jsx';
import {
  DETAIL_FIELDS,
  actionsOf,
  addHandOverCase,
  handOverCases,
  numberProblem,
  removeHandOverCase,
  setDetails,
  setEndCall,
  setHandOver,
  setHandOverCase,
  setLookup,
} from '../../../setup/setupActions.js';
import Button from '../../../../ui/Button.tsx';
import { reachOf } from '../../../setup/setupModel.js';
import { LookupForm } from '../../../setup/SimpleBlocks.jsx';
import { agentLabel, humanize } from '../../rowNames.js';
import { getAtPath } from '../../schemaPath.js';
import { setPath } from '../schemaFacts.js';
import { removeEntry } from '../Detailed.jsx';
import AddItem from '../AddItem.jsx';

// 4 · Tools: what it can do. The four quick abilities are the setup's own switches (setupActions.js makes each tool,
// form, transfer and connection they need); every tool is listed, and the chosen one is laid out from "when it uses it"
// to "if it fails". Rows that only an API tool has are greyed out for the others.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const toolAt = (config, entry) => (entry ? getAtPath(config, entry.base) : null);
const isHttp = (tool) => isObj(tool) && tool.type === 'http';

// the "look something up" form stays open after its switch is turned on, until it is filled in
let lookupOpen = false;
const subs = new Set();
const setLookupOpen = (on) => {
  lookupOpen = on;
  subs.forEach((l) => l());
};
const useLookupOpen = () =>
  useSyncExternalStore(
    (l) => {
      subs.add(l);
      return () => subs.delete(l);
    },
    () => lookupOpen,
  );

function LookupSwitch({ ctx, id }) {
  const on = actionsOf(ctx.config).lookup.on;
  const open = useLookupOpen();
  return (
    <span className="dtSw">
      <Switch
        id={id}
        checked={on || open}
        label="Look something up in your system"
        onChange={(next) => {
          if (next) setLookupOpen(true);
          else {
            setLookupOpen(false);
            ctx.set(setLookup(ctx.config, false).config);
          }
        }}
      />
    </span>
  );
}
function LookupAddress({ ctx }) {
  const state = actionsOf(ctx.config).lookup;
  const open = useLookupOpen();
  if (!state.on && !open) return <span className="dtNote">Switch it on above to say where it looks.</span>;
  return <LookupForm config={ctx.config} set={ctx.set} current={state} onCancel={state.on ? null : () => setLookupOpen(false)} />;
}

// The cases in which it passes people to a person, each with its own number: when (what the model reads to choose the
// case) and where the call goes (empty: it offers a call back). Phone numbers apply to phone calls only.
function HandOverCases({ ctx, id }) {
  const cases = handOverCases(ctx.config);
  if (!cases.length) return <span className="dtNote">Switch it on above, then say when it passes people on.</span>;
  const phone = !!reachOf(ctx.config).sip_voice;
  return (
    <div className="dtCases" id={id} role="group" aria-labelledby={`${id}-label`}>
      {cases.map((c, i) => {
        const problem = numberProblem(c.number);
        return (
          <div className="dtCase" key={c.id} role="group" aria-label={`Case ${i + 1}`}>
            <label className="dtCaseField">
              <span>When</span>
              <TextArea
                rows={2}
                value={c.when}
                placeholder={i ? 'e.g. The caller reports a lost or stolen card' : 'e.g. The caller asks for a person, or it can’t help'}
                onChange={(event) => ctx.set(setHandOverCase(ctx.config, c.id, { when: event.target.value }))}
              />
              {!c.when.trim() && <small className="dtNote">Say when: the agent reads this to choose the case.</small>}
            </label>
            <label className="dtCaseField">
              <span>Number</span>
              <Input
                mono
                value={c.number}
                placeholder="+6561234567"
                disabled={!phone || c.numberElsewhere}
                onChange={(event) => ctx.set(setHandOverCase(ctx.config, c.id, { number: event.target.value }))}
              />
              {c.numberElsewhere ? (
                <small className="dtNote">Chosen by what the caller asks: change it on Connections › Phone transfers.</small>
              ) : problem ? (
                <small className="dtNote">{problem}</small>
              ) : !c.number.trim() ? (
                <small className="dtNote">Empty: it offers a call back instead.</small>
              ) : null}
            </label>
            {cases.length > 1 && (
              <Button type="button" variant="secondary" size="small" className="dtCaseRemove" onClick={() => ctx.set(removeHandOverCase(ctx.config, c.id))}>
                Remove
              </Button>
            )}
          </div>
        );
      })}
      <div>
        <Button type="button" variant="secondary" size="small" onClick={() => ctx.set(addHandOverCase(ctx.config).config)}>
          Add a case
        </Button>
      </div>
      {!phone && <small className="dtNote">Numbers are used on phone calls only; this agent has no phone line yet.</small>}
    </div>
  );
}

// where the end-call tool says its goodbye (params.say), or null without one
const endCallPath = (config) => {
  const at = list(config?.tools).findIndex((t) => isObj(t) && t.type === 'builtin' && t.builtin === 'end_call');
  return at < 0 ? null : ['tools', at, 'params', 'say'];
};

// A line the agent says, which may be text or one of its fixed lines ({ message: id }): shown as its words, and edited
// in place (a fixed line's own text changes, so every place that uses it says the new words).
const textOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? textOf(v.text ?? Object.values(v)[0]) : '');
function lineOf(config, value) {
  if (isObj(value) && typeof value.message === 'string') {
    const at = list(config?.messages).findIndex((m) => isObj(m) && m.id === value.message);
    return { text: at >= 0 ? textOf(config.messages[at].text) : '', fixed: value.message, at };
  }
  return { text: textOf(value), fixed: '', at: -1 };
}
function setLine(config, path, text) {
  const line = lineOf(config, getAtPath(config, path));
  if (line.fixed && line.at >= 0 && typeof config.messages[line.at].text === 'string') return setPath(config, ['messages', line.at, 'text'], text);
  return setPath(config, path, text === '' ? undefined : text);
}

// which agents offer a tool (each agent's `tools` list)
const agentsWith = (config, id) =>
  list(config?.agents?.items)
    .filter((a) => isObj(a) && list(a.tools).includes(id))
    .map((a) => a.id);
function setAgentsWith(config, id, ids) {
  const items = list(config?.agents?.items).map((a) => {
    if (!isObj(a)) return a;
    const has = list(a.tools).includes(id);
    const want = ids.includes(a.id);
    if (has === want) return a;
    return { ...a, tools: want ? [...list(a.tools), id] : list(a.tools).filter((t) => t !== id) };
  });
  return setPath(config, ['agents', 'items'], items);
}

// a tool's method and path, side by side
function MethodPath({ ctx, id, base }) {
  if (!isHttp(getAtPath(ctx.config, base))) return <span className="dtNote">Only a tool that calls your system has an address.</span>;
  const request = getAtPath(ctx.config, [...base, 'request']) || {};
  const set = (key, value) => ctx.set(setPath(ctx.config, [...base, 'request', key], value));
  return (
    <span className="dtInline">
      <Select value={request.method || 'GET'} onChange={(event) => set('method', event.target.value)} aria-label="Method">
        {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </Select>
      <Input id={id} mono value={request.path || ''} placeholder="/bookings" onChange={(event) => set('path', event.target.value)} />
    </span>
  );
}
// how long it waits for the answer, and how many times it tries again
function WaitRetries({ ctx, id, base }) {
  const tool = getAtPath(ctx.config, base) || {};
  if (!isHttp(tool)) return <span className="dtNote">Only a tool that calls your system waits for an answer.</span>;
  const put = (key, n) => ctx.set(setPath(ctx.config, [...base, key], n === null ? undefined : n));
  return (
    <span className="dtNum2">
      <NumberInput id={id} value={tool.timeout_s ?? null} nullable min={0} onChange={(n) => put('timeout_s', n)} aria-label="Give up after, in seconds" />
      <span className="dtUnit">seconds ·</span>
      <NumberInput value={tool.retries ?? null} nullable min={0} integer onChange={(n) => put('retries', n)} aria-label="Retries" />
      <span className="dtUnit">retries</span>
    </span>
  );
}

// a tool row that only an API tool has: its place, or null (greyed out) for the others
const http = (key) => (entry) => (config) => (isHttp(toolAt(config, entry)) ? [...entry.base, ...key] : null);
const own = (key) => (entry) => () => [...entry.base, ...key];
const rowAt = (where, entry, row) => {
  const at = where(entry);
  return {
    ...row,
    pathFor: at,
    disabled: (config) => !at(config),
    get: (config) => (at(config) ? getAtPath(config, at(config)) : undefined),
    put: (config, value) => (at(config) ? setPath(config, at(config), value === '' ? undefined : value) : config),
  };
};

export const toolsPart = {
  id: 'tools',
  num: '4',
  title: 'Tools',
  question: 'What can it do? Four quick abilities, then your own tools, each in the order you think about it.',
  cols: [
    [
      {
        id: 'quick',
        title: 'Quick abilities',
        lead: 'Switch one on and its details open right under it.',
        rows: [
          {
            id: 'end',
            label: 'End the conversation politely',
            hint: 'Says a goodbye, then hangs up',
            kind: 'sw',
            get: (c) => actionsOf(c).end_call.on,
            put: (c, on) => setEndCall(c, on),
            note: (c) => (!actionsOf(c).end_call.on && actionsOf(c).end_call.kept) || '',
          },
          {
            id: 'bye',
            label: 'What it says before hanging up',
            kind: 'long',
            rows: 2,
            pathFor: endCallPath,
            disabled: (c) => !endCallPath(c),
            get: (c) => (endCallPath(c) ? lineOf(c, getAtPath(c, endCallPath(c))).text : undefined),
            put: (c, v) => (endCallPath(c) ? setLine(c, endCallPath(c), v) : c),
            note: (c) => {
              const line = endCallPath(c) ? lineOf(c, getAtPath(c, endCallPath(c))) : null;
              return line?.fixed ? `Its fixed line “${line.fixed}”: changing the words here changes that line everywhere.` : '';
            },
          },
          { id: 'hand', label: 'Pass people to a person', kind: 'sw', get: (c) => actionsOf(c).hand_over.on, put: (c, on) => setHandOver(c, on) },
          {
            id: 'number',
            label: 'When it passes people on, and the number for each',
            hint: 'One case per line. Phone calls only. An empty number: it offers a call back instead',
            render: (c) => <HandOverCases ctx={c} id={c.id} />,
          },
          {
            id: 'details',
            label: 'Take requests and details',
            kind: 'sw',
            get: (c) => actionsOf(c).details.on,
            put: (c, on) => setDetails(c, on, { fields: actionsOf(c).details.fields }),
          },
          {
            id: 'fields',
            label: 'What it asks for',
            kind: 'multi',
            disabled: (c) => !actionsOf(c).details.on,
            options: DETAIL_FIELDS.map((f) => ({ value: f.name, label: f.label, disabled: f.name === 'name' })),
            get: (c) => actionsOf(c).details.fields,
            put: (c, fields) => setDetails(c, true, { fields: fields.includes('name') ? fields : ['name', ...fields] }),
          },
          { id: 'lookup', label: 'Look something up in your system', render: (c) => <LookupSwitch ctx={c} id={c.id} /> },
          { id: 'address', label: 'Web address it asks', hidden: (c) => !actionsOf(c).lookup.on, render: (c) => <LookupAddress ctx={c} /> },
          {
            id: 'finds',
            label: 'What it finds · what it needs',
            hidden: (c) => !actionsOf(c).lookup.on,
            kind: 'note',
            text: (c) => {
              const l = actionsOf(c).lookup;
              return l.on ? `${l.finds || '—'} · ${l.needs || '—'}` : 'Set with the address above.';
            },
          },
        ],
      },
      {
        id: 'mine',
        title: 'Your tools',
        list: {
          id: 'tools',
          path: ['tools'],
          label: 'Tools',
          hint: 'Add: hand over, send back to the first agent, end call, show a form, look up, search knowledge, rules only',
          // by name ("End call"); its id is in the tooltip of its card's Advanced
          nameOf: (t, i) => (isObj(t) && t.id ? humanize(t.id) : `Tool ${i + 1}`),
          renderAdd: (c) => <AddItem ctx={c} path={['tools']} pickerKey="tools" word="tool" onAdded={(key) => c.choose('tools', key)} />,
        },
        rows: [],
      },
    ],
    [
      {
        id: 'tool',
        of: 'tools',
        word: 'tool',
        titleFor: (entry) => (entry ? `A tool: ${entry.name}` : 'A tool'),
        lead: 'Chosen in the list. What it is for first, the technical parts after.',
        empty: 'No tools yet: add one from “Your tools”.',
        remove: (c, entry) => removeEntry(c, 'tools', entry),
        rowsFor: (c) => {
          const entry = c.chosen('tools');
          if (!entry) return [];
          const id = entry.key;
          // what only a tool that calls your system has is required only there; the others say why it is not asked
          const calls = isHttp(toolAt(c.config, entry));
          return [
            rowAt(own(['description']), entry, { id: 'when', label: 'When it uses it', kind: 'long', rows: 2 }),
            {
              id: 'agents',
              label: 'Which agents can use it',
              kind: 'multi',
              options: (config) =>
                list(config?.agents?.items)
                  .filter(isObj)
                  .map((a) => ({ value: a.id, label: agentLabel(config, a.id) })),
              get: (config) => agentsWith(config, id),
              put: (config, ids) => setAgentsWith(config, id, ids),
            },
            {
              id: 'inputs',
              label: 'What the model fills in',
              hint: 'Name, kind, required, description, allowed values',
              errPath: [...entry.base, 'parameters'],
              render: (ctx) => {
                const tool = toolAt(ctx.config, entry) || {};
                return (
                  <ParamsEditor
                    value={tool.parameters}
                    toolName={tool.id}
                    description={tool.description}
                    onChange={(next) => ctx.set(setPath(ctx.config, [...entry.base, 'parameters'], next))}
                  />
                );
              },
            },
            rowAt(http(['connection']), entry, {
              id: 'connection',
              label: 'Connection',
              tags: calls ? 'r' : '',
              kind: calls ? 'pick' : 'note',
              text: 'Only a tool that calls your system has a connection.',
              placeholder: 'Choose a connection…',
              // the connections set up on the Connections part
              options: (config) => Object.keys(isObj(config?.connections) ? config.connections : {}).map((k) => ({ value: k, label: k })),
            }),
            {
              ...rowAt(http(['request']), entry, { id: 'method', label: 'Method and path', tags: calls ? 'r' : '' }),
              kind: 'custom',
              render: (ctx) => <MethodPath ctx={ctx} id={ctx.id} base={entry.base} />,
            },
            rowAt(http(['request']), entry, { id: 'request', label: 'Query, headers and body', kind: 'form' }),
            rowAt(http(['result', 'to_llm']), entry, { id: 'sees', label: 'Fields the model sees', kind: 'list' }),
            rowAt(http(['result', 'to_state']), entry, { id: 'keeps', label: 'Values kept for later', kind: 'form' }),
            rowAt(own(['reply']), entry, {
              id: 'reply',
              label: 'Who speaks next',
              kind: 'ch',
              options: [
                { value: 'model', label: 'The model answers' },
                { value: 'none', label: 'Nothing more is said' },
              ],
            }),
            rowAt(own(['effects']), entry, {
              id: 'effects',
              label: 'Then, in order',
              hint: 'Say, hand over, end, transfer, notify, form, play a sound, log',
              kind: 'form',
            }),
            rowAt(http(['on_error', 'tool_error']), entry, { id: 'fails', label: 'Message if it fails', kind: 'long', rows: 2 }),
            {
              ...rowAt(http(['timeout_s']), entry, { id: 'wait', label: 'Give up after · retries' }),
              kind: 'custom',
              render: (ctx) => <WaitRetries ctx={ctx} id={ctx.id} base={entry.base} />,
            },
          ];
        },
        advFor: (c) => {
          const entry = c.chosen('tools');
          if (!entry) return [];
          const builtin = toolAt(c.config, entry)?.type === 'builtin';
          return [
            rowAt(own(['name']), entry, { id: 'name', label: 'Name the model sees', kind: 'text' }),
            rowAt(http(['result', 'out_of_band']), entry, { id: 'oob', label: 'Sent straight to the caller', kind: 'form' }),
            rowAt(own(['preconditions']), entry, { id: 'pre', label: 'Only allow when…', kind: 'form' }),
            rowAt(own(['limits']), entry, { id: 'limits', label: 'Count attempts in', kind: 'form' }),
            rowAt(own(['channels']), entry, {
              id: 'channels',
              label: 'Channels it works on',
              kind: 'multi',
              options: (config) =>
                list(config?.channels)
                  .filter((ch) => isObj(ch) && ch.id)
                  .map((ch) => ({ value: ch.id, label: ch.id })),
            }),
            rowAt(http(['result']), entry, { id: 'sample', label: 'Try it on a sample response', kind: 'form' }),
            rowAt(own(['parameters']), entry, { id: 'json', label: 'Edit the inputs as JSON', kind: 'code' }),
            // a built-in tool's own settings (which transfer, which form…)
            ...(builtin ? [rowAt(own(['params']), entry, { id: 'params', label: 'Its built-in settings', kind: 'form' })] : []),
          ];
        },
      },
    ],
  ],
};
