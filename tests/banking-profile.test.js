import test from 'node:test';
import assert from 'node:assert/strict';
import { BANKING_NAME_CONSTANT, bankDisplayName, bankingPart, readBankingName, withBankingName } from '../src/studio/banking/bankingProfile.ts';
import { greeting } from '../src/studio/banking/assistantModel.ts';
import { buildSections } from '../src/studio/agent/buildSections.js';
import { PAGE_GROUPS, STAGES } from '../src/studio/agent/pages.js';

// Build → Banking: the bank's name is kept in the draft (a constant), used wherever the bank is named; Banking is the
// second Build page, after Agent.

const draft = (extra = {}) => ({ meta: { name: 'Front Desk' }, persona: { name: 'Ava' }, tools: [], ...extra });
const gatewayTool = { id: 'get_balance', type: 'http', connection: 'banking_gateway' };

test('Banking is the second Build page, right after Agent, in the menu and the Build stage', () => {
  const build = PAGE_GROUPS.find((g) => g.id === 'build').pages.map((p) => p.id);
  assert.deepEqual(build.slice(0, 2), ['agent', 'banking']);
  assert.ok(STAGES.find((s) => s.id === 'build').pages.includes('banking'));
});

test('the banking name is set, edited and cleared in the draft’s constants, keeping the other constants', () => {
  const named = withBankingName(draft({ constants: { banking_gateway_url: 'https://gw.example' } }), '  Acme  Business   Banking');
  assert.equal(named.constants[BANKING_NAME_CONSTANT], 'Acme Business Banking');
  assert.equal(named.constants.banking_gateway_url, 'https://gw.example');
  assert.equal(readBankingName(withBankingName(named, 'Acme Bank')), 'Acme Bank');
  const cleared = withBankingName(named, '   ');
  assert.equal(BANKING_NAME_CONSTANT in cleared.constants, false);
  assert.equal(withBankingName(draft(), 'x'.repeat(200)).constants[BANKING_NAME_CONSTANT].length, 60, 'at most 60 characters');
});

test('the name callers hear: the banking name, else the agent’s persona or its name', () => {
  assert.equal(bankDisplayName(withBankingName(draft(), 'Acme Bank')), 'Acme Bank');
  assert.equal(bankDisplayName(draft()), 'Ava');
  assert.equal(bankDisplayName({ meta: { name: 'Front Desk' } }), 'Front Desk');
  assert.equal(bankDisplayName(null), 'Business Banking');
  assert.match(greeting('morning', 'Acme Bank'), /^Good morning, thank you for calling Acme Bank\./);
  assert.doesNotMatch(greeting(null), /Demo|Mock|Weave/);
});

test('the Banking part says whether the agent is a banking agent, and asks for the bank’s name', () => {
  assert.equal(bankingPart(draft()).state, 'optional');
  assert.deepEqual(bankingPart(draft({ tools: [gatewayTool] })), { state: 'todo', status: 'Still to choose: the bank’s name · 1 banking tool.' });
  assert.deepEqual(bankingPart(withBankingName(draft({ tools: [gatewayTool] }), 'Acme Bank')), { state: 'done', status: 'Acme Bank · 1 banking tool.' });
  const rows = buildSections({ config: draft({ tools: [gatewayTool] }) });
  assert.equal(rows[1].id, 'banking');
  assert.equal(rows[1].state, 'todo');
});
