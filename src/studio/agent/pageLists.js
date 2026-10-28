import { humanize } from './rowNames.js';
import { describeWeek } from '../relations/scheduleStrip.js';
import { usedBy } from '../relations/usedBy.js';

// What the agent's Tools, Channels and Guardrails pages list (with the summary lines of their extra sections), and the
// parts of the Test and Release pages. Used by AgentLayout.jsx.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// "a, b and 2 more": a few names, the rest counted
const namesInWords = (names) => {
  const shown = names.filter(Boolean).slice(0, 2);
  const more = names.filter(Boolean).length - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
};
const hostOf = (url) => {
  try {
    return new URL(String(url)).host;
  } catch {
    return '';
  }
};
// The phone transfers in words: where calls go, or that a number is still to be set
function transfersInWords(config) {
  const transfers = (Array.isArray(config?.telephony?.transfers) ? config.telephony.transfers : []).filter((t) => t && typeof t === 'object');
  if (!transfers.length) return 'None yet. Where a call can be passed to a person.';
  const numbers = transfers.map((t) => (typeof t.target === 'string' ? t.target.trim() : t.target ? 'a number chosen during the call' : '')).filter(Boolean);
  const waiting = transfers.length - numbers.length;
  const parts = [
    numbers.length ? `Passes calls to ${namesInWords(numbers)}` : '',
    waiting ? `${plural(waiting, 'transfer')} with no number yet: callers are offered a callback` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

export const TOOL_LISTS = [
  {
    id: 'tools',
    path: ['tools'],
    kind: 'tools',
    word: 'tool',
    pickerKey: 'tools',
    title: 'All its tools',
    lead: 'Everything it can use, what the switches above add included. Open one to change how it works.',
    empty: { title: 'No tools yet', text: 'Tools let the agent do things: end the call, hand over to a person, look something up.' },
  },
];
export const TOOL_EXTRAS = [
  {
    key: 'telephony',
    title: 'Phone transfers',
    icon: 'phoneTransfer',
    // what is set, not what the section is
    value: (c) => transfersInWords(c),
  },
  {
    key: 'connections',
    title: 'Connections',
    icon: 'plug',
    value: (c, n) =>
      n
        ? `${plural(n, 'connection')}: ${namesInWords(Object.entries(c?.connections || {}).map(([id, x]) => hostOf(x?.base_url) || humanize(id)))}`
        : 'None yet. A connection is a web service its tools call, such as your billing system.',
  },
  {
    key: 'forms',
    title: 'Forms',
    icon: 'records',
    value: (c, n) =>
      n
        ? `${plural(n, 'form')}: ${namesInWords((Array.isArray(c?.forms) ? c.forms : []).map((f) => f?.title || humanize(f?.id || 'form')))}`
        : 'None yet. A form collects details such as a name and number on screen.',
  },
  {
    key: 'notifications',
    title: 'Messages it sends',
    icon: 'mail',
    value: (c, n) => (n ? `${plural(n, 'message')} it can text or email` : 'None yet. Texts and emails it can send during or after a call.'),
  },
  {
    key: 'tasks',
    title: 'Multi-step tasks',
    icon: 'flag',
    value: (c, n) => (n ? plural(n, 'task') : 'None yet. Walk a caller through several steps, such as checking who they are.'),
  },
];
export const CHANNEL_LISTS = [
  {
    id: 'channels',
    path: ['channels'],
    kind: 'channels',
    word: 'channel',
    pickerKey: 'channels',
    title: 'All channels',
    lead: 'Each place it can be reached, and what it says first there. Open one for its details.',
    empty: { title: 'No channels yet', text: 'A channel is where people reach the agent: a phone line, a chat on your website.' },
  },
];
// Business hours in words: one schedule's week and time zone, or the names of several. Hours change nothing on their
// own (a transfer or rule follows them), so an unused one says so.
const scheduleWords = (c, n) => {
  const all = Object.entries(c?.schedules && typeof c.schedules === 'object' ? c.schedules : {});
  if (!n || !all.length) return 'None yet. Opening hours your hand-overs and rules can follow; on their own they change nothing.';
  if (all.length === 1) {
    const [, s] = all[0];
    return `${describeWeek(s).replace(/[.]$/, '')}${typeof s?.timezone === 'string' && s.timezone ? `, ${s.timezone}` : ''}`;
  }
  return `${plural(all.length, 'schedule')}: ${namesInWords(all.map(([id, s]) => (typeof s?.description === 'string' && s.description.trim()) || humanize(id)))}`;
};
const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};
export const CHANNEL_EXTRAS = [
  {
    key: 'schedules',
    title: 'Business hours',
    icon: 'clock',
    value: scheduleWords,
    status: (c, engine) =>
      engine && Object.keys(c?.schedules && typeof c.schedules === 'object' ? c.schedules : {}).some((id) => !usedBy(engine, c, 'schedules', id).length)
        ? { tone: '', text: 'Not used' }
        : null,
    start: {
      title: 'No business hours yet',
      text: 'A phone transfer or a rule can follow them, for example to pass calls to a person only while someone is there.',
      label: 'Start with Monday to Friday, 9 to 5',
      make: (c) => ({
        ...c,
        schedules: {
          business_hours: {
            description: 'Office hours',
            timezone: localZone(),
            weekly: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' }],
          },
        },
      }),
    },
  },
  { key: 'identity', title: 'Caller identity', icon: 'user', value: () => 'How the agent knows who is calling' },
];
export const GUARDRAIL_LISTS = [
  {
    id: 'input',
    path: ['guardrails', 'input'],
    kind: 'guardrails',
    word: 'check',
    pickerKey: 'guardrails.input',
    title: 'On what the caller says',
    lead: 'Checks that run on the caller’s words before the agent answers.',
    empty: {
      title: 'No checks on the caller yet',
      text: 'For example: refuse tricks to change the agent’s instructions, or keep card numbers out of the records.',
    },
  },
  {
    id: 'output',
    path: ['guardrails', 'output'],
    kind: 'guardrails',
    word: 'check',
    pickerKey: 'guardrails.output',
    title: 'On what the agent says',
    lead: 'Checks that run on the agent’s own words before they are spoken.',
    empty: { title: 'No checks on the agent yet', text: 'For example: block a promise it must not make, or keep secret fields out of everything it says.' },
  },
  {
    id: 'escalation',
    path: ['guardrails', 'escalation'],
    kind: 'escalation',
    word: 'rule',
    pickerKey: 'guardrails.escalation',
    title: 'All its hand-over and ending rules',
    lead: 'The ones switched on above, and any of your own: when a call meets one, it hands over or ends by itself.',
    empty: { title: 'No rules yet', text: 'Switch one on above, or add one of your own.' },
  },
];
export const TEST_PARTS = [
  { id: 'try', label: 'Try it' },
  { id: 'callers', label: 'Simulated callers' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'checks', label: 'Readiness checks' },
];
export const RELEASE_PARTS = [
  { id: 'versions', label: 'Versions' },
  { id: 'deploy', label: 'Deploy' },
];
