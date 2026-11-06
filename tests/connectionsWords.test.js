import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formsOf,
  messagesOf,
  reachMap,
  reachersOf,
  sentenceOf,
  summaryLine,
  systemsOf,
  tasksOf,
  transferPath,
  transfersOf,
} from '../src/studio/agent/detailed/connectionsWorkspace/connectionsWords.js';

// an agent of any kind: every sort of system, transfer and thing it shows or sends
const config = {
  connections: {
    customer_records: { type: 'http', base_url: 'https://api.example.com', auth: { type: 'bearer', token: { secret: 'CRM_TOKEN' } } },
    booking_system: { type: 'http', base_url: '' },
    partner_tools: { type: 'mcp', url: 'https://mcp.example.com' },
    texts: { type: 'notifier', kind: 'sms', provider: 'twilio' },
    email: { type: 'notifier', kind: 'email', provider: 'sendgrid' },
  },
  tools: [
    { id: 'look_up_order', type: 'http', connection: 'customer_records' },
    { id: 'end_call', type: 'builtin', builtin: 'end_call' },
  ],
  telephony: {
    transfers: [
      {
        id: 'front_desk',
        method: 'sip_refer',
        target: '+15550123',
        schedule: 'office',
        closed: [{ type: 'say', text: 'We’re closed.' }],
        on_success: [{ type: 'say', text: 'Connecting you now.' }],
      },
      { id: 'support_queue', method: 'http_request', request: { connection: 'customer_records', method: 'POST', path: '/handover' } },
    ],
  },
  schedules: { office: { description: 'Office hours' } },
  forms: [
    {
      id: 'contact',
      title: 'Contact details',
      submit_label: 'Send',
      fields: [{ name: 'name' }, { name: 'phone' }],
      on_submit: [{ type: 'http', connection: 'customer_records' }],
    },
  ],
  notifications: [{ id: 'confirmation', strategy: 'first_success', deliver: [{ via: 'texts' }, { via: 'email' }] }],
  tasks: [{ id: 'verify', kind: 'verification', steps: [{}, {}, {}], max_attempts: 3 }],
};

test('every system: what it is, whether it is ready, and what reaches it', () => {
  const systems = systemsOf(config);
  assert.deepEqual(
    systems.map((s) => [s.name, s.kind, s.state.words, s.users.map((u) => u.name)]),
    [
      ['Customer records', 'Web API', 'Ready', ['Look up order', 'Support queue', 'Contact details']],
      ['Booking system', 'Web API', 'Needs an address', []],
      ['Partner tools', 'MCP server', 'Its tools aren’t run yet', []],
      ['Texts', 'SMS or email sender', 'Ready', ['Confirmation']],
      ['Email', 'SMS or email sender', 'Ready', ['Confirmation']],
    ],
  );
  assert.equal(reachersOf(config).length, 4, 'a tool, a transfer, a form and a message reach out');
});

test('the picture puts what needs a look first and counts what it leaves out', () => {
  const map = reachMap(config, { most: 3 });
  assert.equal(map.systems[0].name, 'Booking system', 'a problem first');
  assert.equal(map.moreSystems, 2);
  assert.ok(
    map.edges.every(([u, s]) => map.users[u].reaches.includes(map.systems[s].id)),
    'each line joins what reaches and what it reaches',
  );
});

test('a transfer, said plainly, and as the path of the call', () => {
  assert.deepEqual(
    transfersOf(config).map((t) => `${t.name}: ${t.how} · ${t.detail} · ${t.state.words}`),
    ['Front desk: By phone (SIP) · +15550123 · in office hours · Ready', 'Support queue: Asks another system · through Customer records · any time · Ready'],
  );
  assert.deepEqual(
    transferPath(config, 'front_desk').map((s) => `${s.title}: ${s.words}`),
    [
      'When: in office hours; else says “We’re closed.”',
      'Before it connects: nothing',
      'Moves the call: by phone (SIP) to +15550123',
      'Once connected: says “Connecting you now.”',
      'If it fails: nothing',
    ],
  );
});

test('what it shows and sends, and the sentence for any agent', () => {
  assert.deepEqual(formsOf(config)[0].detail, '2 questions · “Send” · 1 step when it is sent');
  assert.deepEqual(messagesOf(config)[0].detail, 'a text, else an email · the first way that works');
  assert.deepEqual(tasksOf(config)[0].detail, 'checks who the caller is · 3 steps · up to 3 tries');
  assert.deepEqual(sentenceOf(config).words, { sys: '5 of your systems', tr: '2 places', form: 'a form', msg: 'a message', task: 'a multi-step task' });
  assert.equal(summaryLine(config), '5 systems · 2 phone transfers · 1 form · 1 message · 1 task · 1 needs a look');
  assert.equal(summaryLine({}), 'Nothing yet: it only talks');
});
