import test from 'node:test';
import assert from 'node:assert/strict';
import { minimalConfig } from '../src/demo/minimalConfig.js';
import { applyStarter } from '../src/studio/starters.ts';
import { buildSections } from '../src/studio/agent/buildSections.js';
import { setDetails, setHandOver, setReach, addKnowledgeFile } from '../src/studio/setup/setupModel.js';

// The Build list (src/studio/agent/buildSections.js): one row per part of the agent, in the menu's order, each saying what it is for and where
// it stands, read from the draft.
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

test('a fresh draft: the agent still to write, the optional parts said to be optional, one way to reach it', () => {
  const config = minimalConfig('fresh', 'Fresh');
  config.agents.items[0].instructions = { role: '' };
  const rows = buildSections({ config });
  assert.deepEqual(
    rows.map((r) => r.id),
    ['agent', 'banking', 'knowledge', 'tools', 'workflow', 'channels', 'guardrails', 'aftercall'],
  );
  const s = byId(rows);
  assert.equal(s.agent.state, 'todo');
  assert.match(s.agent.status, /^Still to choose: what it should do/);
  for (const id of ['knowledge', 'tools', 'guardrails', 'aftercall']) assert.equal(s[id].state, 'optional', id);
  assert.equal(s.workflow.status, 'One agent answers every conversation.');
  assert.equal(s.channels.state, 'done');
  assert.ok(rows.every((r) => r.purpose && r.label && r.icon));
});

test('the dental receptionist: what it says, what it can do, its documents and where it is reached', () => {
  let config = applyStarter(minimalConfig('smile', 'Smile Dental'), 'appointment');
  config = setDetails(setHandOver(config, true, { number: '+6561234567' }), true, { fields: ['name', 'phone', 'need', 'when'] });
  config = setReach(config, 'sip_voice', true).config || setReach(config, 'sip_voice', true);
  config = addKnowledgeFile(config, 'prices.txt');
  config.defaults = { ...config.defaults, language: { primary: 'en-US', speaks: ['en', 'zh'] } };
  const s = byId(buildSections({ config }));
  assert.equal(s.agent.state, 'done');
  assert.match(s.agent.status, /^Says “Hello, this is Smile Dental/);
  assert.match(s.agent.status, /English and Chinese/);
  assert.match(s.tools.status, /^Ends politely · passes people to your team \(\+6561234567\) · takes requests\.$/);
  assert.equal(s.knowledge.status, '1 document.');
  assert.match(s.channels.status, /Chat on your website and phone calls\./);
});

test('documents not read yet need attention; problems the checks found put a part first in line', () => {
  const config = addKnowledgeFile(minimalConfig('k', 'K'), 'faq.md');
  const read = { bases: [{ id: 'knowledge', sources: [], build: null }] };
  const knowledge = byId(buildSections({ config, knowledgeRead: read })).knowledge;
  assert.notEqual(knowledge.state, 'done');
  const withErrors = byId(buildSections({ config, errorsByPage: { channels: 2 } })).channels;
  assert.equal(withErrors.state, 'attention');
  assert.match(withErrors.status, /^2 problems to fix · /);
});

test('guardrails and after the call say what is set', () => {
  const config = minimalConfig('g', 'G');
  config.guardrails = { topics: { allowed: ['appointments'], blocked: ['politics'] } };
  config.post_call = {
    summary: { enabled: true },
    analysis: [{ id: 'solved', question: 'Was it solved?', type: 'boolean' }],
    recording: { retention_days: 30 },
  };
  const s = byId(buildSections({ config }));
  assert.equal(s.guardrails.status, 'Keeps to 1 topic · avoids 1 topic.');
  assert.equal(s.aftercall.status, 'Writes a summary · answers 1 question · keeps recordings 30 days.');
});
