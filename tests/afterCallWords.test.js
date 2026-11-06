import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';
import {
  afterCallIn,
  closingOf,
  filesIn,
  hiddenWords,
  hidesOf,
  keepsOf,
  notRunOf,
  questionsIn,
  sampleLine,
  stepWords,
  summaryLine,
} from '../src/studio/agent/detailed/afterCallWorkspace/afterCallWords.js';

// Build › After the call in plain words (afterCallWords.js), for any agent: what it writes, keeps and hides once a call
// ends, how a call closes, what really happens to each, and the gaps a setting plainly has.

const agent = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const full = () => ({
  ...agent(),
  post_call: {
    summary: { enabled: true, prompt: 'Why they called.' },
    analysis: [
      { id: 'solved', type: 'boolean', question: 'Was it solved?' },
      { id: 'why', type: 'enum', question: 'Why did they call?', values: ['A question', 'A problem'] },
    ],
    recording: { transcript: true, retention_days: 30 },
    redaction: { enabled: true, entities: ['card_number', 'pin'] },
    artifacts: [
      { kind: 'transcript', sink: { type: 'file', directory: 'records' } },
      { kind: 'metrics', enabled: false, sink: { type: 'http', connection: 'billing', method: 'POST', path: '/calls' } },
    ],
  },
  observability: { session_log: { retention_days: 90 } },
  wrapups: [{ id: 'closing', wait_s: 10, on_silence: [{ type: 'say', text: 'Goodbye' }, { type: 'end_call' }] }],
});

test('what is not done yet: the server’s own report when it has answered, else the guide’s list', () => {
  assert.deepEqual(notRunOf(agent(), undefined), { summary: false, questions: false, recording: false }, 'nothing set, nothing to say');
  assert.deepEqual(notRunOf(full(), undefined), { summary: true, questions: true, recording: true }, 'before the report: the guide');
  assert.deepEqual(notRunOf(full(), []), { summary: false, questions: false, recording: false }, 'a server that lists nothing is believed');
  assert.deepEqual(notRunOf(full(), [{ feature: 'post-call summary', where: 'post_call.summary' }]), { summary: true, questions: false, recording: false });
});

test('a question in words, with what it plainly lacks', () => {
  const config = full();
  config.post_call.analysis.push({ id: 'empty', type: 'enum', question: 'Which?', values: [] }, { id: 'blank', type: 'boolean', question: '' }, null);
  const q = questionsIn(config);
  assert.deepEqual(
    q.map((x) => [x.key, x.name, x.words, x.gap]),
    [
      ['0', 'Was it solved?', 'Yes or no', ''],
      ['1', 'Why did they call?', 'One of 2 answers', ''],
      ['2', 'Which?', 'One of a list', 'One of a list, with no answers to pick from'],
      ['3', 'Question 4', 'Yes or no', 'No words yet: say what it should ask'],
    ],
  );
  assert.equal(q[1].more, 'a question, a problem');
});

test('closing a call: how long it waits, what then, and whether anything starts it', () => {
  assert.equal(closingOf(agent()), null);
  const c = closingOf(full());
  assert.deepEqual([c.waitWords, c.then, c.started], ['10 seconds', 'says “Goodbye” and hangs up', false]);
  const started = { ...full(), events: [{ on: 'call_started', do: [{ type: 'wrapup', wrapup: 'closing' }] }] };
  assert.equal(closingOf(started).started, true);
  assert.equal(stepWords({ type: 'end_call', say: { message: 'Bye now' } }), 'says “Bye now” and hangs up');
  assert.equal(stepWords({ type: 'handoff', to: 'billing' }, { agents: { items: [{ id: 'billing', name: 'Billing desk' }] } }), 'hands over to Billing desk');
});

test('what it keeps: the log is on unless switched off, files in words', () => {
  const k = keepsOf(agent());
  assert.deepEqual([k.log, k.logDays, k.transcript, k.audio, k.files.length], [true, null, false, false, 0]);
  const off = keepsOf({ observability: { session_log: { enabled: false } } });
  assert.equal(off.log, false);
  assert.deepEqual(
    filesIn(full()).map((f) => [f.what, f.where, f.on]),
    [
      ['The transcript', 'to the folder records', true],
      ['The call’s numbers', 'sent to billing (POST /calls)', false],
    ],
  );
  assert.equal(keepsOf(full()).logDays, 90);
});

test('what it hides: the kinds, a gap when nothing is looked for, secret values even with no hiding set up', () => {
  const h = hidesOf(full());
  assert.equal(hiddenWords(h), 'card numbers and PINs');
  assert.equal(h.gap, '');
  assert.deepEqual(sampleLine(h), [
    ['My card is ', false],
    ['[REDACTED]', true],
    [' and my PIN is ', false],
    ['[REDACTED]', true],
    ['.', false],
  ]);
  const none = hidesOf({ post_call: { redaction: { enabled: true } } });
  assert.equal(none.gap, 'Hiding is on, but nothing is chosen to look for');
  const bare = hidesOf(agent());
  assert.deepEqual([bare.on, bare.secrets, bare.gap], [false, true, ''], 'with no hiding, secret values are still hidden');
  assert.equal(hidesOf({ post_call: { redaction: { enabled: true, patterns: ['\\d{6}'] } } }).gap, '', 'a pattern of its own is something to look for');
});

test('the line under the name counts what is set, and what needs a look', () => {
  assert.equal(summaryLine(afterCallIn(agent())), 'Keeps a log of each call');
  assert.equal(summaryLine(afterCallIn(full())), '1 summary · 2 questions · 2 kinds of record · 2 files · 3 things hidden');
  assert.equal(summaryLine(afterCallIn(full()), 1), '1 summary · 2 questions · 2 kinds of record · 2 files · 3 things hidden · 1 needs a look');
});
