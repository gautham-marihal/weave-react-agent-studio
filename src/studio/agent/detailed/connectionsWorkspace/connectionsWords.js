// Build › Connections in plain words, for any agent: the systems it reaches (web APIs, MCP servers, texts and emails),
// what reaches out to each (tools, transfers, forms, messages, tasks, reactions, a search service), where a hand-over
// takes the caller, and what it shows and sends. Pure: no React, no DOM, so the tests run it in Node.

import { connectionState, kindOf, metaOf } from '../parts/connectionModel.js';
import { countSteps, plural, stepsWords } from '../describe.js';
import { humanize } from '../../rowNames.js';

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v : isObj(v) && typeof v.text === 'string' ? v.text : '');
export const together = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] || '');

// what can reach out to a system, where it lives in the config, and its words
const REACHERS = [
  { list: 'tools', path: ['tools'], word: 'tool', icon: 'bolt' },
  { list: 'transfers', path: ['telephony', 'transfers'], word: 'phone transfer', icon: 'phoneTransfer' },
  { list: 'forms', path: ['forms'], word: 'form', icon: 'records' },
  { list: 'notifications', path: ['notifications'], word: 'message', icon: 'mail' },
  { list: 'tasks', path: ['tasks'], word: 'multi-step task', icon: 'list' },
  { list: 'events', path: ['events'], word: 'reaction', icon: 'bolt' },
  { list: 'knowledge', path: ['knowledge'], word: 'search service', icon: 'book' },
];
// the keys that point at a connection (setupActions POINTERS.connections)
const POINTS = ['connection', 'server', 'via'];

const at = (config, path) => path.reduce((v, k) => (v == null ? v : v[k]), config);
const nameOf = (item, i, word) =>
  (isObj(item) && typeof item.title === 'string' && item.title) ||
  (isObj(item) && typeof item.id === 'string' && humanize(item.id)) ||
  `${humanize(word)} ${i + 1}`;

// the connections an item points at, anywhere inside it
function pointsIn(node, ids, found = new Set()) {
  if (Array.isArray(node)) node.forEach((n) => pointsIn(n, ids, found));
  else if (isObj(node))
    Object.entries(node).forEach(([k, v]) => {
      if (POINTS.includes(k) && typeof v === 'string' && ids.includes(v)) found.add(v);
      else pointsIn(v, ids, found);
    });
  return found;
}

const connectionIds = (config) => Object.keys(isObj(config?.connections) ? config.connections : {});

// everything that reaches out, and the systems each reaches: { users: [{ list, key, name, kind, icon, reaches }] }
export function reachersOf(config) {
  const ids = connectionIds(config);
  return REACHERS.flatMap((r) =>
    list(at(config, r.path)).flatMap((item, i) => {
      const reaches = [...pointsIn(item, ids)];
      if (!reaches.length) return [];
      return [
        {
          list: r.list,
          key: isObj(item) && typeof item.id === 'string' ? item.id : String(i),
          name: nameOf(item, i, r.word),
          kind: r.word,
          icon: r.icon,
          reaches,
        },
      ];
    }),
  );
}

// every system: what it is, where, whether it is ready, and what uses it
export function systemsOf(config) {
  const users = reachersOf(config);
  return connectionIds(config).map((id) => {
    const item = config.connections[id];
    const kind = kindOf(item?.type);
    let state = connectionState(item);
    // MCP servers are kept, but the server doesn't run their tools yet (its /validate list)
    if (state.tone === 'good' && item?.type === 'mcp') state = { tone: 'warn', words: 'Its tools aren’t run yet' };
    return {
      id,
      name: humanize(id),
      type: item?.type || '',
      kind: kind.label,
      icon: item?.type === 'notifier' ? (item.kind === 'email' ? 'mail' : 'chat') : kind.icon,
      meta: metaOf(item),
      state,
      users: users.filter((u) => u.reaches.includes(id)),
    };
  });
}

// the picture: the things that reach out and the systems, the busiest first, and the lines between them
export function reachMap(config, { most = 6 } = {}) {
  const systems = systemsOf(config);
  const users = reachersOf(config);
  const rank = (s) => (s.state.tone === 'bad' ? -1 : 0) * 1000 - s.users.length;
  const shownSystems = [...systems].sort((a, b) => rank(a) - rank(b)).slice(0, most);
  const shownIds = shownSystems.map((s) => s.id);
  const shownUsers = users
    .filter((u) => u.reaches.some((id) => shownIds.includes(id)))
    .sort((a, b) => b.reaches.length - a.reaches.length)
    .slice(0, most);
  const edges = shownUsers.flatMap((u, ui) => u.reaches.filter((id) => shownIds.includes(id)).map((id) => [ui, shownIds.indexOf(id)]));
  // the systems set up but reached by nothing yet: drawn with dashed lines, through one "nothing uses it yet" node
  const idle = shownSystems.map((sys, i) => (sys.users.length ? -1 : i)).filter((i) => i >= 0);
  return {
    systems: shownSystems,
    users: shownUsers,
    edges,
    idle,
    moreSystems: systems.length - shownSystems.length,
    moreUsers: users.length - shownUsers.length,
  };
}

// ---- where a hand-over takes the caller
const scheduleName = (config, id) => (isObj(config?.schedules?.[id]) && config.schedules[id].description) || humanize(id);
function targetWords(target) {
  if (typeof target === 'string') return target;
  if (isObj(target) && typeof target.secret === 'string') return 'a number kept as a secret';
  if (isObj(target)) return 'a lookup by what the caller wants';
  return '';
}
export function transfersOf(config) {
  return list(config?.telephony?.transfers)
    .filter(isObj)
    .map((t, i) => {
      const sip = t.method === 'sip_refer';
      const http = t.method === 'http_request';
      const to = targetWords(t.target);
      const via = t.request?.connection;
      return {
        id: typeof t.id === 'string' ? t.id : String(i),
        name: nameOf(t, i, 'transfer'),
        how: sip ? 'By phone (SIP)' : http ? 'Asks another system' : 'Not set up yet',
        detail: [
          sip ? to || 'no number yet' : http && via ? `through ${humanize(via)}` : '',
          t.schedule ? `in ${scheduleName(config, t.schedule).toLowerCase()}` : 'any time',
        ]
          .filter(Boolean)
          .join(' · '),
        icon: sip ? 'phone' : 'phoneTransfer',
        state: !t.method
          ? { tone: 'bad', words: 'Needs a way to transfer' }
          : sip && !t.target
            ? { tone: 'bad', words: 'Needs where to' }
            : http && !t.request
              ? { tone: 'bad', words: 'Needs the request' }
              : { tone: 'good', words: 'Ready' },
      };
    });
}

// a transfer as the path of the call, each step in a few words
const stepCount = (steps) => countSteps(steps).top;
const firstSay = (steps) => {
  const say = list(steps).find((s) => isObj(s) && s.type === 'say');
  return say ? `says “${text(say.text).slice(0, 40)}${text(say.text).length > 40 ? '…' : ''}”` : '';
};
const stepsOrNothing = (steps) => {
  const n = stepCount(steps);
  if (!n) return 'nothing';
  return n === 1 && firstSay(steps) ? firstSay(steps) : plural(n, 'step');
};
export function transferPath(config, id) {
  const t = list(config?.telephony?.transfers).find((x) => isObj(x) && x.id === id);
  if (!t) return [];
  const sip = t.method === 'sip_refer';
  return [
    {
      key: 'when',
      n: 1,
      title: 'When',
      words: t.schedule ? `in ${scheduleName(config, t.schedule).toLowerCase()}; else ${stepsOrNothing(t.closed)}` : 'any time',
    },
    {
      key: 'before',
      n: 2,
      title: 'Before it connects',
      words: stepsOrNothing(t.before) + (typeof t.delay_s === 'number' && t.delay_s ? `, then waits ${t.delay_s} s` : ''),
    },
    {
      key: 'moves',
      n: 3,
      title: 'Moves the call',
      words: sip
        ? `by phone (SIP)${targetWords(t.target) ? ` to ${targetWords(t.target)}` : ''}`
        : t.method === 'http_request'
          ? `asks ${humanize(t.request?.connection || 'another system')}`
          : 'not set up yet',
    },
    { key: 'connected', n: 4, title: 'Once connected', words: stepsOrNothing(t.on_success) },
    { key: 'fails', n: 5, title: 'If it fails', words: stepsOrNothing(t.on_failure), fail: true },
  ];
}

export const phoneSystemWords = (config) => {
  const pbx = config?.telephony?.pbx;
  return isObj(pbx) && pbx.host ? `${pbx.host}${pbx.port ? `:${pbx.port}` : ''}` : '';
};

// ---- what it shows and sends
export function formsOf(config) {
  return list(config?.forms)
    .filter(isObj)
    .map((f, i) => {
      const n = list(f.fields).length;
      const steps = stepsWords(f.on_submit);
      return {
        list: 'forms',
        id: typeof f.id === 'string' ? f.id : String(i),
        name: nameOf(f, i, 'form'),
        what: 'A form',
        icon: 'records',
        detail: [plural(n, 'question'), f.submit_label ? `“${f.submit_label}”` : '', steps ? `${steps.replace(/, with .*/, '')} when it is sent` : '']
          .filter(Boolean)
          .join(' · '),
        state: n ? null : { tone: 'bad', words: 'No questions yet' },
      };
    });
}
const VIA = (config, via) => {
  const c = config?.connections?.[via];
  return isObj(c) && c.type === 'notifier' ? (c.kind === 'email' ? 'an email' : 'a text') : 'a message';
};
export function messagesOf(config) {
  return list(config?.notifications)
    .filter(isObj)
    .map((m, i) => {
      const ways = list(m.deliver).filter(isObj);
      const kinds = ways.map((w) => VIA(config, w.via));
      return {
        list: 'notifications',
        id: typeof m.id === 'string' ? m.id : String(i),
        name: nameOf(m, i, 'message'),
        what: 'A message',
        icon: 'mail',
        detail: ways.length
          ? [
              kinds.length > 1 ? `${kinds[0]}, ${m.strategy === 'all' ? 'and' : 'else'} ${kinds.slice(1).join(', ')}` : kinds[0],
              m.strategy === 'all' ? 'every way' : 'the first way that works',
            ].join(' · ')
          : 'no way to send it yet',
        state: ways.length ? null : { tone: 'bad', words: 'Needs a way to send it' },
      };
    });
}
const TASK_KINDS = { verification: 'checks who the caller is', collect_fields: 'collects details', confirmation: 'confirms something', custom: 'its own kind' };
export function tasksOf(config) {
  return list(config?.tasks)
    .filter(isObj)
    .map((t, i) => {
      const steps = list(t.steps).length;
      return {
        list: 'tasks',
        id: typeof t.id === 'string' ? t.id : String(i),
        name: nameOf(t, i, 'task'),
        what: 'A multi-step task',
        icon: 'list',
        detail: [TASK_KINDS[t.kind] || '', plural(steps, 'step'), t.max_attempts ? `up to ${plural(t.max_attempts, 'try', 'tries')}` : '']
          .filter(Boolean)
          .join(' · '),
        state: steps ? null : { tone: 'bad', words: 'No steps yet' },
      };
    });
}

// ---- the sentence and the line under the name
export function sentenceOf(config) {
  const n = {
    sys: connectionIds(config).length,
    tr: transfersOf(config).length,
    form: formsOf(config).length,
    msg: messagesOf(config).length,
    task: tasksOf(config).length,
  };
  const a = (k, one, many) => (n[k] === 1 ? one : `${n[k]} ${many}`);
  return {
    n,
    words: {
      sys: n.sys ? (n.sys === 1 ? 'a system of yours' : `${n.sys} of your systems`) : '',
      tr: n.tr ? a('tr', 'one place', 'places') : '',
      form: n.form ? a('form', 'a form', 'forms') : '',
      msg: n.msg ? a('msg', 'a message', 'messages') : '',
      task: n.task ? a('task', 'a multi-step task', 'multi-step tasks') : '',
    },
  };
}
export function summaryLine(config) {
  const { n } = sentenceOf(config);
  const bad = systemsOf(config).filter((s) => s.state.tone === 'bad').length;
  const parts = [
    n.sys && plural(n.sys, 'system'),
    n.tr && plural(n.tr, 'phone transfer'),
    n.form && plural(n.form, 'form'),
    n.msg && plural(n.msg, 'message'),
    n.task && plural(n.task, 'task'),
  ].filter(Boolean);
  if (!parts.length) return 'Nothing yet: it only talks';
  return `${parts.join(' · ')}${bad ? ` · ${bad} ${bad === 1 ? 'needs' : 'need'} a look` : ''}`;
}
