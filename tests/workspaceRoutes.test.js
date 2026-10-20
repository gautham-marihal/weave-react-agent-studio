import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY_NAV, NAV, SETTINGS_NAV, TELEPHONY_SECTIONS, parseWorkspaceHash, workspaceHref } from '../src/pages/helpers.js';

// Every page of the workspace has an address, so a refresh, a bookmark and Back keep you on it; an agent keeps its own (#/bots/...).

test('every page of the sidebar but Agents has an address, and reading it back gives the same page', () => {
  [...NAV, ...LIBRARY_NAV, ...SETTINGS_NAV]
    .filter((item) => item.id !== 'agents')
    .forEach((item) => {
      const href = workspaceHref(item.id);
      assert.match(href, /^#\/[a-z]+$/, item.id);
      assert.equal(parseWorkspaceHash(href).id, item.id, href);
    });
  assert.equal(workspaceHref('sessions'), '#/calls', 'Calls is "calls" in the address');
});

test('each part of Telephony has its own address, and an unknown part opens Simulated calls', () => {
  TELEPHONY_SECTIONS.forEach((part) => {
    const href = workspaceHref('telephony', part.id);
    assert.equal(href, `#/telephony/${part.id}`);
    assert.deepEqual(parseWorkspaceHash(href), { id: 'telephony', section: part.id });
  });
  assert.deepEqual(parseWorkspaceHash('#/telephony'), { id: 'telephony', section: 'calls' });
  assert.deepEqual(parseWorkspaceHash('#/telephony/nope'), { id: 'telephony', section: 'calls' });
  assert.equal(workspaceHref('telephony', 'nope'), '#/telephony');
});

test('an agent’s address, an empty one and an unknown one are not workspace pages', () => {
  assert.equal(parseWorkspaceHash('#/bots'), null);
  assert.equal(parseWorkspaceHash('#/bots/acme/tools'), null);
  assert.equal(parseWorkspaceHash(''), null);
  assert.equal(parseWorkspaceHash('#/'), null);
  assert.equal(parseWorkspaceHash('#/nowhere'), null);
  assert.equal(parseWorkspaceHash('#/calls?x=1').id, 'sessions', 'a query is ignored');
  assert.equal(workspaceHref('nowhere'), '#/home');
});
