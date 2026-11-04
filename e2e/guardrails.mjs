// Guardrails and After the call in plain words, in a real browser, on the demo (no backend): topics, the moments it hands over or ends by itself, limits;
// a summary, questions about each call, what is recorded and the recording notice, the sensitive details hidden; what each writes into the draft. And
// each input asked in one place only: the Agent part doesn't ask the recording notice, Channels has no phone transfers (they are on Connections). The
// Workflow's panel changes the first agent's instructions in place: the same ones as on the Agent part.
// Nothing is written anywhere but the demo.
//
//   npm run dev:demo      (in one terminal)
//   node e2e/guardrails.mjs
//
// Environment: E2E_BASE (default http://localhost:5173), E2E_BROWSER (path to Chrome or Edge), E2E_HEADED=1 to watch, E2E_SHOTS=folder to save pictures.
import { chromium } from 'playwright-core';

const BASE = process.env.E2E_BASE || 'http://localhost:5173';
const OUT = process.env.E2E_SHOTS || '';
async function launch() {
  const headless = process.env.E2E_HEADED !== '1';
  if (process.env.E2E_BROWSER) return chromium.launch({ executablePath: process.env.E2E_BROWSER, headless });
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless });
    } catch {
      /* try the next one */
    }
  }
  throw new Error('No Chrome or Edge found. Set E2E_BROWSER to the path of one.');
}
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  if (sessionStorage.getItem('guardrails')) return;
  sessionStorage.setItem('guardrails', '1');
  localStorage.setItem('weave_theme', 'light');
  localStorage.setItem('weave_profile', JSON.stringify({ fullName: 'Sam', email: 'sam@example.test', workspaceName: 'Clinic', role: 'Operations' }));
  localStorage.removeItem('weave_demo_state');
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
});
await page.route(
  (u) => u.pathname.startsWith('/api/') || u.pathname.startsWith('/llm'),
  (r) => r.abort(),
);
const wait = (ms = 600) => page.waitForTimeout(ms);
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failed += 1;
};
const go = async (h) => {
  await page.evaluate((x) => (location.hash = x), h);
  await wait(1700);
};
const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('weave_demo_state') || '{}').bots?.['acme-support']?.config);
const save = async () => {
  await page
    .locator('.nlBar')
    .getByRole('button', { name: /^Save$/ })
    .click();
  await wait(1200);
};
await page.goto(BASE);
await page
  .getByRole('button', { name: /sign in|get started|start/i })
  .first()
  .click();
await page.getByPlaceholder('you@company.com').fill('sam@example.test');
await page.getByPlaceholder('Enter your password').fill('x12345678');
await page.getByRole('button', { name: /continue to workspace/i }).click();
await page.waitForSelector('.dashMain');

// ---- Guardrails
await go('#/bots/acme-support/guardrails');
const field = (id) => page.locator(`[data-field="${id}"]`);
// a word typed into a list of words, and Enter adds it
const addChip = async (id, word) => {
  await field(id).locator('input').fill(word);
  await field(id).locator('input').press('Enter');
  await wait(200);
};
await addChip('guardrails.allowed', 'orders and deliveries');
await addChip('guardrails.blocked', 'medical advice');
await page.locator('#dt-guardrails-offtopic').click();
await wait(300);
await page.locator('#dt-guardrails-abusive').click();
await page.locator('#dt-guardrails-frustrated').click();
await wait(300);
await page.locator('#dt-guardrails-max_call_duration_s').fill('10');
await wait(300);
check('a limit has the line it says when it ends the call beside it', (await field('guardrails.limitSay').count()) === 1);
const ruleChips = await field('guardrails.rules').locator('.dtItems > button[aria-current]').allInnerTexts();
check('the rules switched on are listed with your own', ruleChips.length === 2 && ruleChips.some((r) => /frustrated_to_person/.test(r)), ruleChips.join(' | '));
if (OUT) {
  await field('guardrails.offtopic').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/guardrails-topics.png` });
  await page.locator('[data-card="guardrails.limits"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/guardrails-limits.png` });
}
await save();
let g = (await draft()).guardrails;
check('topics are written', JSON.stringify(g.topics.allowed) === '["orders and deliveries"]' && JSON.stringify(g.topics.blocked) === '["medical advice"]');
check(
  'off topic: after 3 tries it runs a tool',
  g.topics.on_off_topic?.max_strikes === 3 && !!g.topics.on_off_topic?.then,
  JSON.stringify(g.topics.on_off_topic),
);
check('the longest call is kept in seconds', g.limits?.max_call_duration_s === 600, JSON.stringify(g.limits));
check('two rules for handing over and ending', g.escalation?.length === 2 && g.escalation.some((r) => r.id === 'abusive_end' && r.action === 'end_call'));
// a rule opens in place, with all of its settings
await field('guardrails.rules').locator('.dtItems > button[aria-current]').first().click();
await wait(1200);
check('a rule opens in place', (await field('guardrails.rules').locator('.dtInlineItem .stForm').count()) === 1);

// ---- After the call
await go('#/bots/acme-support/aftercall');
await page.locator('#dt-aftercall-summary').click();
await wait(300);
await page.locator('#dt-aftercall-cover').fill('Why they called and what to follow up.');
await page.getByRole('button', { name: /Was the caller’s problem solved\?/ }).click();
await page.getByRole('button', { name: /Why did they get in touch\?/ }).click();
await wait(300);
await page.locator('#dt-aftercall-transcript').click();
await page.locator('#dt-aftercall-days').fill('30');
await page.locator('#dt-aftercall-notice').fill('This call is recorded.');
// hiding is off until it is switched on (an agent that never set it doesn't hide anything, as the release checklist says)
const hiding = page.locator('#dt-aftercall-hide');
check('hiding sensitive details shows off until it is switched on', (await hiding.getAttribute('aria-checked')) === 'false');
await hiding.click();
await wait(300);
// switched on, it starts from the kinds the agent already handles: a kind is pressed only when it is not chosen yet
const choose = async (name) => {
  const pill = field('aftercall.entities').getByRole('button', { name });
  if ((await pill.getAttribute('aria-pressed')) !== 'true') await pill.click();
};
await choose('Card numbers');
await choose('PINs');
await wait(500);
const notices = await page.locator('.dtPage label', { hasText: /^Recording notice$/ }).count();
check('the recording notice is asked once, on the Recording card', notices === 1, String(notices));
if (OUT) {
  await page.locator('[data-card="aftercall.recording"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/aftercall-recording.png` });
}
await save();
const c = await draft();
check('summary on with what it covers', c.post_call.summary.enabled === true && /follow up/.test(c.post_call.summary.prompt));
check(
  'two questions with ids and kinds',
  c.post_call.analysis.length === 2 && c.post_call.analysis[0].type === 'boolean' && c.post_call.analysis[1].values.length === 5,
  JSON.stringify(c.post_call.analysis),
);
check(
  'transcript kept 30 days',
  c.post_call.recording.transcript === true && c.post_call.recording.retention_days === 30,
  JSON.stringify(c.post_call.recording),
);
check('the notice is where it always was', c.persona.disclosures.recording_notice === 'This call is recorded.');
check('card numbers and PINs are hidden', JSON.stringify(c.post_call.redaction.entities) === '["card_number","pin"]', JSON.stringify(c.post_call.redaction));

// ---- each input in one place
await go('#/bots/acme-support/agent');
const agentText = await page.locator('.dtPage').innerText();
check('the Agent part does not ask for the recording notice', !/Recording notice|What callers are told/.test(agentText));
check('its name is the one it introduces itself by', (await field('agent.persona').count()) === 1);
await go('#/bots/acme-support/channels');
check('Channels has no phone transfers now', (await page.locator('[data-card$=".transfers"]').count()) === 0);
check('Channels no longer asks for the recording notice', (await page.locator('.dtPage label', { hasText: 'Recording notice' }).count()) === 0);
await go('#/bots/acme-support/connections');
check('Connections has the phone transfers', (await page.locator('[data-card="connections.transfers"]').count()) === 1);
await go('#/bots/acme-support/workflow');
await page
  // the agent's block (the Start block above it says the greeting, which has the agent's name in it too)
  .locator('.wfNode.agent')
  .filter({ hasText: 'Acme Support' })
  .first()
  .click()
  .catch(() => {});
await wait(800);
// the first agent's instructions, changed in the Workflow's panel: they are the Agent part's too
const roleBox = page.locator('.wfInspector textarea[id$="-role"]');
check('Workflow lets you change the first agent’s instructions where its block is', (await roleBox.count()) === 1 && (await roleBox.isEditable()));
if (OUT) await page.screenshot({ path: `${OUT}/workflow-role.png` });
const newRole = 'You help Acme customers with orders, returns and repairs. Ask one question at a time.';
if (await roleBox.count()) {
  await roleBox.fill(newRole);
  await wait(500);
  await go('#/bots/acme-support/agent');
  await wait(900);
  const agentRole = page.getByRole('textbox', { name: 'What the agent should do (its role)' });
  check('and the Agent part shows the same instructions', (await agentRole.count()) > 0 && (await agentRole.first().inputValue()) === newRole);
}
// ---- the paths that were broken once: a setting shown from the canvas, a rule of one's own, numbers and lists typed as people type them
await go('#/bots/acme-support/workflow');
await page.locator('.wfNode.agent').filter({ hasText: 'Acme Support' }).first().click();
await wait(700);
await page.getByRole('button', { name: 'All settings for this subagent' }).click();
await wait(1600);
check(
  '“All settings for this subagent” opens Subagents and hand-overs with the subagent shown',
  /\/subagents/.test(page.url()) && (await page.locator('.dtRow.dtFlash[data-path^="agents"]').count()) === 1,
  page.url(),
);
await go('#/bots/acme-support/guardrails');
const own = field('guardrails.rules');
const before = await own.locator('.dtItems > button[aria-current]').count();
await own.getByRole('button', { name: 'Add a rule' }).click();
await wait(700);
check('a rule of one’s own can be added', (await own.locator('.dtItems > button[aria-current]').count()) === before + 1);
const tries = page.locator('#dt-guardrails-strikes');
await tries.click();
await tries.press('Control+a');
await tries.press('Backspace');
await tries.type('5');
const longest = page.locator('#dt-guardrails-max_call_duration_s');
await longest.click();
await longest.press('Control+a');
await longest.type('0.5');
await wait(300);
check('a box being typed in keeps what is typed (5 tries, half a minute)', (await tries.inputValue()) === '5' && (await longest.inputValue()) === '0.5');
// the rule added above is a new one with nothing in it yet: taken out again, so the draft is valid to save
await own.getByRole('button', { name: 'Delete this rule' }).click();
await wait(300);
await save();
g = (await draft()).guardrails;
check('…and they are kept as 5 tries and 30 seconds', g.topics?.on_off_topic?.max_strikes === 5 && g.limits?.max_call_duration_s === 30);
await go('#/bots/acme-support/aftercall');
const choices = page.locator('#dt-aftercall-q1-values');
await choices.click();
await choices.type('Billing, Delivery, Returns');
check('a list typed with commas keeps them while typing', (await choices.inputValue()) === 'Billing, Delivery, Returns');
// leaving the box makes them answers (one each), and Save appears
await choices.press('Tab');
await wait(300);
await save();
check(
  'and leaving the box, then Save, keeps the list, one answer each',
  JSON.stringify((await draft()).post_call.analysis[1].values.slice(-3)) === '["Billing","Delivery","Returns"]',
  JSON.stringify((await draft()).post_call.analysis[1].values),
);

check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
console.log(failed ? `\n${failed} check(s) failed` : '\nall passed');
await browser.close();
process.exit(failed ? 1 : 0);
