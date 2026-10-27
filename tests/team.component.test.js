import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { $, $$, actions, byText, setupDom, teardownDom, textOf } from './component/dom.js';
import { applyStarter } from '../src/studio/starters.ts';
import { minimalConfig } from '../src/demo/demoApi.js';
import { openTeam } from '../src/studio/team/useTeam.js';

// The Team page and an agent's Share panel in jsdom: people are invited with a role and either the whole workspace or only some agents, and the access that
// comes out is read back from the page.
const { mountScreen, act } = await setupDom();
const a = actions(act);
after(() => teardownDom());

const AGENTS = [
  { id: 'a', name: 'Acme Support' },
  { id: 'b', name: 'Billing' },
  { id: 'c', name: 'Sales' },
];
const config = () => applyStarter(minimalConfig('acme', 'Acme'), 'support');
const drawer = () => $(document.body, '.nlDrawer');
let n = 0;
// each test has a team of its own, so one does not leave people for the next
beforeEach(() => {
  n += 1;
  openTeam({ workspaceId: `t${n}`, profile: { fullName: 'Owner', email: 'owner@acme.com' }, demo: false, agentIds: ['a', 'b', 'c'] });
});
// an address is typed in the one-line field and added with Enter
const field = () => $(drawer(), 'input[aria-label="Email address"]');
const pressEnter = (el) =>
  act(async () => {
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
const addEmail = async (email) => {
  await a.type(field(), email);
  await pressEnter(field());
};
const rowOf = (app, email) => $(app.container, `.tmRow[data-member="${email}"]`);

test('a new workspace has one person on the team: its owner, with the whole workspace', async () => {
  const app = await mountScreen('team', config(), { ready: '.tmPage', props: { agents: AGENTS } });
  assert.equal($$(app.container, '.tmRow').length, 1);
  assert.match(textOf(rowOf(app, 'owner@acme.com')), /Owner.*Whole workspace/);
  assert.equal($(rowOf(app, 'owner@acme.com'), 'button'), null, 'the owner has no change or remove');
  assert.match(textOf($(app.container, '.stNotice')), /Preview: saved in this browser only/);
  await app.unmount();
});

test('inviting asks what they may do and where: the whole workspace, or only the agents ticked, and says what that gives', async () => {
  const app = await mountScreen('team', config(), { ready: '.tmPage', props: { agents: AGENTS } });
  await a.click(byText(app.container, 'button', /Invite people/));
  assert.ok(drawer());
  assert.equal($(drawer(), 'textarea'), null, 'one line, not a big box');
  await addEmail('sam@acme.com');
  await addEmail('kim@acme.com');
  assert.deepEqual(
    $$(drawer(), '.tmEmails li').map((li) => textOf(li).replace('×', '').trim()),
    ['sam@acme.com', 'kim@acme.com'],
  );
  assert.equal(field().value, '', 'the field is empty for the next one');
  assert.match(textOf($(drawer(), '.tmGrant')), /Editor: can see, try, change and publish every agent in the workspace, including agents made later/);
  await a.click($(drawer(), 'input[aria-label="Only some agents"]'));
  assert.match(textOf($(drawer(), '.tmGrant')), /Choose at least one agent/);
  assert.ok($(drawer(), '.primaryCta').disabled, 'it cannot be sent with no agent');
  await a.click($(drawer(), 'input[aria-label="Acme Support"]'));
  await a.click($(drawer(), 'input[aria-label="Sales"]'));
  assert.match(textOf($(drawer(), '.tmGrant')), /2 agents: Acme Support and Sales\. Nothing else in the workspace/);
  await a.click(byText(drawer(), 'button', /Send 2 invitations/));
  assert.equal(drawer(), null, 'the panel closes');
  assert.match(textOf(rowOf(app, 'sam@acme.com')), /Editor.*Acme Support and 1 more.*Invited/);
  assert.match(textOf(rowOf(app, 'kim@acme.com')), /Acme Support, Sales/);
  await app.unmount();
});

test('a bad address, and someone already on the team, are named and nothing is sent', async () => {
  const app = await mountScreen('team', config(), { ready: '.tmPage', props: { agents: AGENTS } });
  await a.click(byText(app.container, 'button', /Invite people/));
  await a.type(field(), 'nope');
  await pressEnter(field());
  assert.match(textOf($(drawer(), '.tmProblems')), /“nope” is not an email address/);
  assert.equal($$(drawer(), '.tmEmails li').length, 0, 'it was not added');
  await a.type(field(), 'owner@acme.com');
  await pressEnter(field());
  assert.match(textOf($(drawer(), '.tmProblems')), /owner@acme\.com is already on the team/);
  await a.type(field(), 'sam@acme.com');
  assert.equal($(drawer(), '.tmProblems'), null, 'typing again clears the message');
  await pressEnter(field());
  await addEmail('sam@acme.com');
  assert.match(textOf($(drawer(), '.tmProblems')), /already on the team/, 'the same address twice is also refused');
  assert.equal($$(drawer(), '.tmEmails li').length, 1);
  await a.click($(drawer(), 'button[aria-label="Remove sam@acme.com"]'));
  assert.equal($$(drawer(), '.tmEmails li').length, 0, 'an added address can be taken out');
  await a.type(field(), '');
  assert.ok($(drawer(), '.primaryCta').disabled, 'nothing to send');
  assert.equal($$(app.container, '.tmRow').length, 1);
  await app.unmount();
});

test('an admin always has the whole workspace: choosing admin turns "only some agents" off', async () => {
  const app = await mountScreen('team', config(), { ready: '.tmPage', props: { agents: AGENTS } });
  await a.click(byText(app.container, 'button', /Invite people/));
  await a.click($(drawer(), 'input[aria-label="Only some agents"]'));
  await a.click($(drawer(), 'input[aria-label="Admin"]'));
  assert.equal($(drawer(), 'input[aria-label="Only some agents"]').disabled, true);
  assert.equal($(drawer(), 'input[aria-label="The whole workspace"]').checked, true);
  assert.match(textOf($(drawer(), '.tmGrant')), /Admin: can .* every agent in the workspace/);
  await app.unmount();
});

test('access can be changed after the invitation, and a person can be removed after a confirmation', async () => {
  const app = await mountScreen('team', config(), { ready: '.tmPage', props: { agents: AGENTS } });
  await a.click(byText(app.container, 'button', /Invite people/));
  await a.type(field(), 'sam@acme.com');
  await a.click($(drawer(), 'input[aria-label="Viewer"]'));
  await a.click(byText(drawer(), 'button', /Send invitation/));
  assert.match(textOf(rowOf(app, 'sam@acme.com')), /Viewer.*Whole workspace/);
  await a.click($(rowOf(app, 'sam@acme.com'), 'button[aria-label="Change access of Sam"]'));
  assert.ok($(drawer(), '.primaryCta').disabled, 'nothing to save until something changes');
  await a.click($(drawer(), 'input[aria-label="Only some agents"]'));
  await a.click($(drawer(), 'input[aria-label="Billing"]'));
  await a.click($(drawer(), 'input[aria-label="Editor"]'));
  await a.click(byText(drawer(), 'button', 'Save access'));
  assert.match(textOf(rowOf(app, 'sam@acme.com')), /Editor.*Billing/);
  await a.click($(rowOf(app, 'sam@acme.com'), 'button[aria-label="Remove Sam"]'));
  assert.match(textOf(rowOf(app, 'sam@acme.com')), /Remove Sam\?/);
  await a.click(byText(rowOf(app, 'sam@acme.com'), 'button', 'Keep'));
  assert.ok(rowOf(app, 'sam@acme.com'), 'Keep leaves them');
  await a.click($(rowOf(app, 'sam@acme.com'), 'button[aria-label="Remove Sam"]'));
  await a.click(byText(rowOf(app, 'sam@acme.com'), 'button', 'Remove'));
  assert.equal(rowOf(app, 'sam@acme.com'), null);
  await app.unmount();
});

test('the list can be filtered to the people who can open one agent', async () => {
  const app = await mountScreen('team', config(), { ready: '.tmPage', props: { agents: AGENTS } });
  for (const [email, only] of [
    ['one@acme.com', 'Acme Support'],
    ['two@acme.com', 'Billing'],
  ]) {
    await a.click(byText(app.container, 'button', /Invite people/));
    await a.type(field(), email);
    await a.click($(drawer(), 'input[aria-label="Only some agents"]'));
    await a.click($(drawer(), `input[aria-label="${only}"]`));
    await a.click(byText(drawer(), 'button', /Send invitation/));
  }
  await a.choose($(app.container, '.rxSelect[aria-label="Who can open"]'), 'a');
  const emails = $$(app.container, '.tmRow').map((r) => r.getAttribute('data-member'));
  assert.deepEqual(emails.sort(), ['one@acme.com', 'owner@acme.com']);
  await app.unmount();
});

test('an agent’s Share panel lists who can open it, and shares only that agent with someone new', async () => {
  const app = await mountScreen('share', config(), { ready: '.tmShareList', props: {} });
  const list = () => $$(document.body, '.tmShareList li').map(textOf);
  assert.equal(list().length, 1);
  assert.match(list()[0], /Owner.*Whole workspace/);
  await a.type($(document.body, '#tm-share-emails'), 'guest@acme.com');
  await a.click($(document.body, 'input[aria-label="Viewer"]'));
  await a.click(byText(document.body, 'button', 'Share Acme Support'));
  assert.equal(list().length, 2);
  assert.match(list()[1], /guest@acme\.com.*Viewer.*This agent only/);
  assert.match(textOf($(document.body, '.tmDone')), /Shared Acme Support with guest@acme\.com as viewer/);
  await a.click($(document.body, 'button[aria-label="Stop sharing with Guest"]'));
  assert.equal(list().length, 1, 'someone who had only this agent leaves the team');
  await app.unmount();
});
