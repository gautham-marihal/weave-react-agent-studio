import React, { useState } from 'react';
import { Input } from '../../../../ui/Input.tsx';
import { freshId, renameEverywhere, ID_PATTERN, describeUsage, findUsage } from '../../../form/references.js';
import { TryTaskView } from '../../../form/TryPanels.jsx';
import { getAtPath } from '../../schemaPath.js';
import { setPath } from '../schemaFacts.js';
import { FormRow, removeEntry } from '../Detailed.jsx';
import { AddConnection, CONNECTION_KINDS, describeConnection } from './ConnectionsOverview.jsx';
import { clip, joinAnd, plural, stepsWords } from '../describe.js';
import SignIn from '../connectionsWorkspace/SignIn.jsx';
import ConnectionsWorkspace from '../connectionsWorkspace/ConnectionsWorkspace.jsx';

// 5 · Connections: what its tools reach (systems, transfers, forms, messages, tasks). Each was a long list inside Tools; now each kind has its
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
  // a name another item of the list already has would merge the two (a map) or make two of one id (a list)
  const taken = (ctx.items?.(entry.list || collection) || []).some((other) => other.key === shown && other.key !== entry.key);
  const ok = new RegExp(ID_PATTERN).test(shown) && !taken;
  const commit = () => {
    if (typed === null || typed === entry.key) return setTyped(null);
    // not a name it can take: the box keeps what was typed, with the reason under it
    if (!ok) return undefined;
    if (ctx.engine) {
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
      {!ok && (
        <small className="stFieldError" role="alert">
          {taken ? 'Another one already has this name.' : 'Lowercase letters, digits, _ or -, starting with a letter.'}
        </small>
      )}
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

// Who points at an item, in words ("Used by tool “lookup”"), or what to do so something does
const usedBy = (ctx, collection, key, none) => {
  const places = ctx.engine ? describeUsage(ctx.config, findUsage(ctx.engine, ctx.config, collection, key)) : [];
  return places.length ? `Used by ${places.join(', ')}` : none;
};

// The words for each list's rows: what the item is and where it stands (Detailed.jsx ItemRows)
const DESCRIBE = {
  transfers: (entry, ctx) => {
    const t = isObj(entry.item) ? entry.item : {};
    const how =
      t.method === 'http_request'
        ? `Asks another system${t.request?.connection ? ` (${t.request.connection})` : ''}`
        : t.method === 'sip_refer'
          ? 'Over the phone line (SIP)'
          : '';
    return {
      icon: 'phoneTransfer',
      meta: [how, t.schedule ? 'only in business hours' : '', t.play_dialtone ? 'plays a dial tone' : ''].filter(Boolean).join(' · ') || 'Not set up yet',
      detail: t.description ? clip(t.description) : usedBy(ctx, 'transfers', entry.key, 'Not used yet: a tool or hand-over passes callers to it.'),
      state: !t.method
        ? { tone: 'bad', words: 'Needs a way to transfer' }
        : t.target || t.request
          ? { tone: 'good', words: 'Ready' }
          : { tone: 'bad', words: 'Needs where to' },
    };
  },
  forms: (entry, ctx) => {
    const f = isObj(entry.item) ? entry.item : {};
    const fields = Array.isArray(f.fields) ? f.fields : [];
    const steps = stepsWords(f.on_submit);
    return {
      icon: 'list',
      meta: [plural(fields.length, 'question'), f.submit_label ? `button “${f.submit_label}”` : ''].filter(Boolean).join(' · '),
      detail: steps ? `When it is sent: ${steps}` : usedBy(ctx, 'forms', entry.key, 'Nothing happens when it is sent yet.'),
      state: fields.length ? null : { tone: 'bad', words: 'No questions yet' },
    };
  },
  notifications: (entry, ctx) => {
    const n = isObj(entry.item) ? entry.item : {};
    const ways = Array.isArray(n.deliver) ? n.deliver.filter(isObj) : [];
    const via = [...new Set(ways.map((w) => w.via).filter(Boolean))];
    return {
      icon: 'mail',
      meta: ways.length ? `${plural(ways.length, 'way')} to send it${via.length ? `, through ${joinAnd(via)}` : ''}` : 'No way to send it yet',
      detail: usedBy(ctx, 'notifications', entry.key, 'Not sent by any step yet.'),
      state: ways.length ? null : { tone: 'bad', words: 'Needs a way to send it' },
    };
  },
  tasks: (entry, ctx) => {
    const t = isObj(entry.item) ? entry.item : {};
    const steps = Array.isArray(t.steps) ? t.steps : [];
    const kinds = { verification: 'Checks who the caller is', collect_fields: 'Collects details', confirmation: 'Confirms something', custom: 'Custom' };
    return {
      icon: 'list',
      meta: [kinds[t.kind] || '', plural(steps.length, 'step'), t.max_attempts ? `up to ${plural(t.max_attempts, 'try', 'tries')}` : '']
        .filter(Boolean)
        .join(' · '),
      detail: usedBy(ctx, 'tasks', entry.key, 'Not started by any tool yet: a task tool on Tools starts it.'),
      state: steps.length ? null : { tone: 'bad', words: 'No steps yet' },
    };
  },
};

const card = ({ id, title, lead, path, collection, word, label, nameOf, add, rows, adv, icon, empty }) => ({
  id,
  title,
  lead,
  word,
  list: { id, path, label, nameOf, add, icon, empty, describe: DESCRIBE[id] },
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

export const connectionsForm = {
  id: 'connections',
  num: '5',
  title: 'Connections',
  question: 'The systems it reaches, where it passes callers on, and the forms, messages and tasks it uses.',
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
              id: 'name',
              label: 'Name',
              hint: 'What its tools call it. Renaming it renames it everywhere it is used.',
              render: (c) => <IdName ctx={c} id={c.id} entry={{ ...entry, list: 'connections' }} collection="connections" />,
            },
            {
              id: 'kind',
              label: 'What it is',
              kind: 'ch',
              options: CONNECTION_KINDS.map((k) => ({ value: k.value, label: k.label })),
              hint: 'Changing it keeps the address and starts the new kind’s own settings afresh.',
              get: (config) => getAtPath(config, [...entry.base, 'type']),
              put: (config, type) => setKind(config, entry.base, type),
            },
            {
              id: 'address',
              label: 'Address',
              hint: 'Where the service is. Its tools add their own paths, such as /accounts, to it.',
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
            // a texts-or-emails sender: what it sends, through which service, from whom
            at(
              entry,
              ['kind'],
              {
                id: 'sends',
                label: 'It sends',
                kind: 'ch',
                options: [
                  { value: 'sms', label: 'Texts (SMS)' },
                  { value: 'email', label: 'Emails' },
                ],
              },
              (item) => item?.type === 'notifier',
            ),
            at(
              entry,
              ['provider'],
              {
                id: 'provider',
                label: 'Service',
                tags: 'r',
                kind: 'text',
                placeholder: 'twilio',
                hint: 'The company that sends them, such as twilio, sendgrid or microsoft_graph.',
              },
              (item) => item?.type === 'notifier',
            ),
            at(
              entry,
              ['from'],
              { id: 'from', label: 'Sends from', kind: 'text', hint: 'The number, address or mailbox people see. Empty: the service’s default.' },
              (item) => item?.type === 'notifier',
            ),
          ],
          adv: (entry) => [
            {
              ...at(entry, ['auth'], {
                id: 'auth',
                label: 'Sign-in',
                hint: 'How the agent proves who it is to this service. The key itself stays on the server as a secret; only its name is saved here.',
              }),
              kind: 'custom',
              render: (c) => <SignIn ctx={c} id={c.id} value={c.value} onChange={c.onChange} entry={entry} />,
            },
            at(
              entry,
              ['headers'],
              {
                id: 'headers',
                label: 'Headers',
                hint: 'Extra information sent with every request to this service, such as an account number it expects.',
                kind: 'form',
              },
              (item) => item?.type === 'http',
            ),
            at(
              entry,
              ['timeout_s'],
              {
                id: 'timeout',
                label: 'Give up after',
                hint: 'How long to wait for this service to answer before the request stops. Empty: the server’s default.',
                kind: 'num',
                unit: 'seconds',
              },
              (item) => item?.type === 'http',
            ),
            at(
              entry,
              ['transport'],
              {
                id: 'transport',
                label: 'How it connects',
                hint: 'Leave it as it is unless the server’s makers say otherwise.',
                kind: 'ch',
                options: [
                  { value: 'streamable_http', label: 'Streamable HTTP' },
                  { value: 'sse', label: 'Server-sent events (older servers)' },
                ],
              },
              (item) => item?.type === 'mcp',
            ),
          ],
        }),
        list: {
          id: 'connections',
          path: ['connections'],
          label: 'Connections',
          nameOf: (item, key) => key,
          icon: 'plug',
          mono: true,
          emptyTitle: 'No connections yet',
          empty: 'Connect the systems its tools should reach: a web API, an MCP server, or a service that sends texts and emails.',
          // a row per connection, and the guided Add (what, which service, address, sign-in, review)
          describe: describeConnection,
          renderAdd: (c) => <AddConnection ctx={c} />,
        },
        lead: 'The systems its tools talk to. Each is set up once and used by as many tools as need it.',
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
          at(entry, ['on_success'], { id: 'success', label: 'Once connected', hint: 'Steps that run once the call has moved', kind: 'form' }),
          at(entry, ['description'], {
            id: 'about',
            label: 'What it is for',
            hint: 'In a sentence, for whoever looks after the agent.',
            kind: 'long',
            rows: 2,
          }),
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
          {
            id: 'name',
            label: 'Name',
            hint: 'What steps and tools call it. Renaming it renames it everywhere it is used.',
            render: (c) => <IdName ctx={c} id={c.id} entry={{ ...entry, list: 'forms' }} collection="forms" />,
          },
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
        adv: (entry) => [
          at(entry, ['on_failure'], { id: 'failed', label: 'If it fails', kind: 'form' }),
          at(entry, ['description'], {
            id: 'about',
            label: 'What it is for',
            hint: 'In a sentence, for whoever looks after the agent.',
            kind: 'long',
            rows: 2,
          }),
          {
            id: 'name',
            label: 'Name',
            hint: 'What steps and tools call it. Renaming it renames it everywhere it is used.',
            render: (c) => <IdName ctx={c} id={c.id} entry={{ ...entry, list: 'notifications' }} collection="notifications" />,
          },
        ],
      }),
      card({
        id: 'tasks',
        title: 'Multi-step tasks',
        // what a task is, in the agent config guide's words (sections 1, 2.1 and 3.17)
        lead: 'A short conversation with the caller that ends in a result, such as checking who they are. An agent starts one with a task tool on Tools; the steps go in order, and code checks each answer, not the model.',
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
          at(entry, ['inactivity'], { id: 'quiet', label: 'If the caller goes quiet', hint: 'During this task only', kind: 'form' }),
          at(entry, ['description'], {
            id: 'about',
            label: 'What it is for',
            hint: 'In a sentence, for whoever looks after the agent.',
            kind: 'long',
            rows: 2,
          }),
          {
            id: 'name',
            label: 'Name',
            hint: 'What steps and tools call it. Renaming it renames it everywhere it is used.',
            render: (c) => <IdName ctx={c} id={c.id} entry={{ ...entry, list: 'tasks' }} collection="tasks" />,
          },
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

export const connectionsPart = { ...connectionsForm, render: (ctx) => <ConnectionsWorkspace ctx={ctx} form={connectionsForm} /> };

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
