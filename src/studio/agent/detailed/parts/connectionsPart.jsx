import React, { useState } from 'react';
import { Input } from '../../../../ui/Input.tsx';
import { freshId, renameEverywhere, ID_PATTERN } from '../../../form/references.js';
import { TryTaskView } from '../../../form/TryPanels.jsx';
import { getAtPath } from '../../schemaPath.js';
import { setPath } from '../schemaFacts.js';
import { FormRow, removeEntry } from '../Detailed.jsx';

// 5 · Connections, transfers and forms: what its tools reach. Each was a long list inside Tools; now each kind has its
// own card, its items as chips and the chosen one's fields under them. Everything here is pointed at from elsewhere
// (a tool's connection, a hand-over's transfer, a form a tool shows), and those places pick from these lists.

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const byKind = { http: 'base_url', mcp: 'url' };

// A row of the chosen item: its place in the draft (`key` under the item), or null (greyed out) when `when` says no.
const at = (entry, key, row, when = () => true) => {
  const where = (config) => (entry && when(getAtPath(config, entry.base)) ? [...entry.base, ...key] : null);
  return {
    ...row,
    pathFor: where,
    disabled: (config) => !where(config),
    get: (config) => (where(config) ? getAtPath(config, where(config)) : undefined),
    put: (config, value) => (where(config) ? setPath(config, where(config), value === '' ? undefined : value) : config),
  };
};

// An item's id as a name: renaming it renames every place that points at it (a tool's transfer, a hand-over…).
function IdName({ ctx, id, entry, collection }) {
  const [typed, setTyped] = useState(null);
  const shown = typed ?? entry.key;
  const ok = new RegExp(ID_PATTERN).test(shown);
  const commit = () => {
    if (typed === null || typed === entry.key) return setTyped(null);
    if (ok && ctx.engine) {
      ctx.set(renameEverywhere(ctx.engine, ctx.config, collection, entry.key, typed));
      ctx.choose(entry.list || collection, typed);
    }
    return setTyped(null);
  };
  return (
    <>
      <Input
        id={id}
        mono
        value={shown}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === 'Enter' && commit()}
      />
      {!ok && <small className="stFieldError">Lowercase letters, digits, _ or -, starting with a letter.</small>}
    </>
  );
}

// a connection's kind: changing it keeps its address, and starts the new kind's own settings afresh
function setKind(config, base, type) {
  const now = getAtPath(config, base) || {};
  const address = now.base_url || now.url || '';
  const next = type === 'http' ? { type, base_url: address } : type === 'mcp' ? { type, url: address } : { type: 'notifier', kind: 'sms', provider: '' };
  return setPath(config, base, next);
}

// "When it succeeds · fails · is declined": the three outcomes of a task, each folded until opened
function Outcomes({ ctx, entry }) {
  return (
    <div className="dtStack">
      {[
        ['on_success', 'When it succeeds'],
        ['on_failure', 'When it fails'],
        ['on_decline', 'When it is declined'],
      ].map(([key, label]) => (
        <div key={key} className="dtSub">
          <span className="dtSubLabel">{label}</span>
          <FormRow row={{ label, path: [...entry.base, key] }} id={`dt-task-${key}`} value={getAtPath(ctx.config, [...entry.base, key])} ctx={ctx} />
        </div>
      ))}
    </div>
  );
}

const card = ({ id, title, path, collection, word, label, nameOf, add, rows, adv }) => ({
  id,
  title,
  word,
  list: { id, path, label, nameOf, add },
  of: id,
  empty: `None yet.`,
  remove: (c, entry) => removeEntry(c, collection, entry),
  rowsFor: (c) => {
    const entry = c.chosen(id);
    return entry ? rows(entry, c) : [];
  },
  advFor: (c) => {
    const entry = c.chosen(id);
    return entry && adv ? adv(entry, c) : [];
  },
});

export const connectionsPart = {
  id: 'connections',
  num: '5',
  title: 'Connections, transfers and forms',
  question: 'What do its tools reach? These were one long list at the bottom of Tools; now each kind has its own card.',
  cols: [
    [
      {
        ...card({
          id: 'connections',
          title: 'Connections',
          path: ['connections'],
          collection: 'connections',
          word: 'connection',
          label: 'Connections',
          nameOf: (item, key) => key,
          add: (config) => {
            const key = freshId(Object.keys(isObj(config?.connections) ? config.connections : {}), 'connection');
            return { config: setPath(config, ['connections', key], { type: 'http', base_url: '' }), key };
          },
          rows: (entry) => [
            {
              id: 'kind',
              label: 'Kind',
              kind: 'ch',
              options: [
                { value: 'http', label: 'Web API' },
                { value: 'mcp', label: 'MCP server' },
                { value: 'notifier', label: 'SMS or email sender' },
              ],
              get: (config) => getAtPath(config, [...entry.base, 'type']),
              put: (config, type) => setKind(config, entry.base, type),
            },
            {
              id: 'address',
              label: 'Address',
              tags: 'r',
              kind: 'text',
              placeholder: 'https://api.example.com',
              pathFor: (config) => {
                const key = byKind[getAtPath(config, [...entry.base, 'type'])];
                return key ? [...entry.base, key] : null;
              },
              disabled: (config) => !byKind[getAtPath(config, [...entry.base, 'type'])],
              get: (config) => {
                const key = byKind[getAtPath(config, [...entry.base, 'type'])];
                return key ? getAtPath(config, [...entry.base, key]) : undefined;
              },
              put: (config, value) => {
                const key = byKind[getAtPath(config, [...entry.base, 'type'])];
                return key ? setPath(config, [...entry.base, key], value ?? '') : config;
              },
            },
            at(entry, ['auth'], { id: 'auth', label: 'Sign-in', hint: 'Names a server secret; the value never shows', kind: 'form' }),
            at(entry, ['headers'], { id: 'headers', label: 'Headers', kind: 'form' }, (item) => item?.type === 'http'),
            at(entry, ['timeout_s'], { id: 'timeout', label: 'Give up after', kind: 'num', unit: 'seconds' }, (item) => item?.type === 'http'),
          ],
        }),
        lead: 'The systems its tools talk to. Set once, used by many tools.',
      },
      card({
        id: 'transfers',
        title: 'Phone transfers',
        path: ['telephony', 'transfers'],
        collection: 'transfers',
        word: 'transfer',
        label: 'Phone transfers',
        nameOf: (t, i) => (isObj(t) && t.id) || `Transfer ${i + 1}`,
        add: (config) => addTransfer(config),
        rows: (entry) => [
          { id: 'name', label: 'Name', tags: 'r', render: (c) => <IdName ctx={c} id={c.id} entry={{ ...entry, list: 'transfers' }} collection="transfers" /> },
          at(entry, ['method'], {
            id: 'method',
            label: 'How to transfer',
            tags: 'r',
            kind: 'ch',
            options: [
              { value: 'sip_refer', label: 'By SIP' },
              { value: 'http_request', label: 'Ask another system over HTTP' },
            ],
          }),
          at(entry, ['target'], { id: 'target', label: 'Where to', hint: 'A number, a secret or a lookup', kind: 'form' }),
          at(entry, ['play_dialtone'], { id: 'tone', label: 'Play a dial tone', kind: 'sw' }),
          at(entry, ['schedule'], {
            id: 'hours',
            label: 'Business hours',
            kind: 'pick',
            placeholder: 'Always open',
            // the hours set up on the Channels part
            options: (config) =>
              Object.keys(isObj(config?.schedules) ? config.schedules : {}).map((k) => ({ value: k, label: config.schedules[k]?.description || k })),
          }),
          at(entry, ['closed'], { id: 'closed', label: 'When closed', kind: 'form' }),
          at(entry, ['on_failure'], { id: 'failed', label: 'If it fails', kind: 'form' }),
        ],
        adv: (entry) => [
          { id: 'pbx', label: 'Phone system: host, port, transport, trunk, number', kind: 'form', path: ['telephony', 'pbx'] },
          at(entry, ['uri_template'], { id: 'uri', label: 'Address template', kind: 'text' }),
          at(entry, ['headers'], { id: 'headers', label: 'Headers', kind: 'form' }),
          at(entry, ['request'], { id: 'request', label: 'Request', kind: 'form' }),
          at(entry, ['before'], { id: 'before', label: 'Before it connects', kind: 'form' }),
          at(entry, ['delay_s'], { id: 'delay', label: 'Delay', kind: 'num', unit: 'seconds' }),
        ],
      }),
    ],
    [
      card({
        id: 'forms',
        title: 'Forms',
        path: ['forms'],
        collection: 'forms',
        word: 'form',
        label: 'Forms',
        nameOf: (f, i) => (isObj(f) && (f.title || f.id)) || `Form ${i + 1}`,
        add: (config) =>
          addTo(config, ['forms'], 'form', (id) => ({ id, title: 'New form', fields: [{ name: 'name', label: 'Name', type: 'text', required: true }] })),
        rows: (entry) => [
          at(entry, ['title'], { id: 'title', label: 'Title', kind: 'text' }),
          at(entry, ['fields'], { id: 'fields', label: 'Fields', hint: 'Type, must fill, choices, pattern', kind: 'form' }),
          at(entry, ['submit_label'], { id: 'button', label: 'Button text', kind: 'text', placeholder: 'Send' }),
          at(entry, ['store_in_state'], { id: 'keep', label: 'Keep the answers in', kind: 'form' }),
          at(entry, ['on_submit'], { id: 'sent', label: 'When it is sent', kind: 'form' }),
        ],
        adv: (entry) => [
          at(entry, ['otherwise'], { id: 'otherwise', label: 'If the channel cannot show it', kind: 'form' }),
          at(entry, ['description'], { id: 'description', label: 'Description', kind: 'long', rows: 2 }),
        ],
      }),
      card({
        id: 'notifications',
        title: 'Messages it sends',
        path: ['notifications'],
        collection: 'notifications',
        word: 'message',
        label: 'Messages',
        nameOf: (n, i) => (isObj(n) && n.id) || `Message ${i + 1}`,
        add: (config) => addTo(config, ['notifications'], 'message', (id) => ({ id, deliver: [] })),
        rows: (entry) => [
          at(entry, ['deliver'], { id: 'deliver', label: 'Ways to send it', hint: 'Via, to, subject, body, format, attachments', kind: 'form' }),
          at(entry, ['strategy'], {
            id: 'strategy',
            label: 'How to deliver',
            kind: 'ch',
            options: [
              { value: 'first_success', label: 'Stop at the first that works' },
              { value: 'all', label: 'Send to all' },
            ],
          }),
        ],
        adv: (entry) => [at(entry, ['on_failure'], { id: 'failed', label: 'If it fails', kind: 'form' })],
      }),
      card({
        id: 'tasks',
        title: 'Multi-step tasks',
        path: ['tasks'],
        collection: 'tasks',
        word: 'task',
        label: 'Tasks',
        nameOf: (t, i) => (isObj(t) && t.id) || `Task ${i + 1}`,
        add: (config) => addTo(config, ['tasks'], 'task', (id) => ({ id, kind: 'custom', steps: [] })),
        rows: (entry) => [
          at(entry, ['kind'], {
            id: 'kind',
            label: 'Kind',
            kind: 'ch',
            options: [
              { value: 'verification', label: 'Verification' },
              { value: 'collect_fields', label: 'Collect details' },
              { value: 'confirmation', label: 'Confirmation' },
              { value: 'custom', label: 'Custom' },
            ],
          }),
          at(entry, ['steps'], { id: 'steps', label: 'Steps', kind: 'form' }),
          at(entry, ['max_attempts'], { id: 'attempts', label: 'Most attempts', kind: 'num', integer: true }),
          { id: 'outcomes', label: 'When it succeeds · fails · is declined', render: (c) => <Outcomes ctx={c} entry={entry} /> },
          // the try-out that was under a task: its steps, one by one, and how it ends
          { id: 'tryTask', label: 'Try this task', tags: 'p', render: (c) => <TryTaskView config={c.config} taskId={entry.key} /> },
        ],
        adv: (entry) => [
          at(entry, ['instructions'], { id: 'instructions', label: 'Instructions', kind: 'long', rows: 3 }),
          at(entry, ['use_prior_context'], { id: 'prior', label: 'Use what was already said', kind: 'sw' }),
          at(entry, ['attempts_scope'], {
            id: 'scope',
            label: 'How wrong answers count',
            kind: 'ch',
            options: [
              { value: 'step', label: 'Per step' },
              { value: 'task', label: 'For the whole task' },
            ],
          }),
          at(entry, ['skip_if'], { id: 'skip', label: 'Already done when', kind: 'form' }),
          at(entry, ['return_history'], {
            id: 'history',
            label: 'What the agent remembers',
            kind: 'ch',
            options: [
              { value: 'result_only', label: 'Only the result' },
              { value: 'full', label: 'The whole exchange' },
            ],
          }),
        ],
      }),
    ],
  ],
};

// a new item at the end of a list, with a fresh id; its key is that id, so its card opens
function addTo(config, path, word, make) {
  const items = list(getAtPath(config, path));
  const id = freshId(
    items.map((i) => i?.id),
    word,
  );
  return { config: setPath(config, path, [...items, make(id)]), key: id };
}
function addTransfer(config) {
  return addTo(config, ['telephony', 'transfers'], 'transfer', (id) => ({ id, method: 'sip_refer' }));
}
