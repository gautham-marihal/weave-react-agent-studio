// Guardrails and After the call in plain words, in a real browser, on the demo (no backend): topics, the moments it hands over or ends by itself, limits;
// a summary, questions about each call, what is recorded and the recording notice, the sensitive details hidden; what each writes into the draft. And
// each input asked in one place only: the personality panel no longer asks tone, style rules or the recording notice, a channel's panel no longer asks
// its first line, and phone transfers sit on Tools beside the hand-over. The Workflow's panel changes the first agent's instructions in place: the same
// ones as on the Agent page.
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
const addChip = async (label, word) => {
  const field = page.locator('.smChips', { hasText: label }).first();
  await field.locator('input').fill(word);
  await field.getByRole('button', { name: 'Add' }).click();
  await wait(200);
};
await addChip('What it talks about', 'orders and deliveries');
await addChip('What it must not talk about', 'medical advice');
await page.locator('.suAction', { hasText: 'When someone keeps going off topic' }).getByRole('switch').click();
await wait(300);
await page.locator('.suAction', { hasText: 'End the call when someone is abusive' }).getByRole('switch').click();
await page.locator('.suAction', { hasText: 'Pass a frustrated caller to a person' }).getByRole('switch').click();
await wait(300);
await page.locator('.smLimit', { hasText: 'Longest call' }).locator('input').fill('10');
await wait(300);
check(
  'a limit brings the line it says when it ends the call',
  (await page.locator('.suField', { hasText: 'What it says when a limit ends the call' }).count()) === 1,
);
const ruleRows = await page.locator('.nlSection', { hasText: 'All its hand-over and ending rules' }).locator('.nlRow').allInnerTexts();
check(
  'the rules switched on are listed in words',
  ruleRows.length === 2 && ruleRows.some((r) => /sounds frustrated \(2 turns in a row\): pass them to a person/.test(r)),
  ruleRows.join(' | '),
);
if (OUT) {
  await page.locator('.suAction', { hasText: 'When someone keeps going off topic' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/guardrails-topics.png` });
  await page.locator('.smLimits').scrollIntoViewIfNeeded();
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
// a rule opens in its full panel
await page.locator('.nlSection', { hasText: 'All its hand-over and ending rules' }).locator('.nlRow').first().click();
await wait(1200);
check('a rule opens in a panel', (await page.locator('.nlDrawer').count()) === 1);
await page.keyboard.press('Escape');
await wait(400);

// ---- After the call
await go('#/bots/acme-support/aftercall');
await page.locator('.suAction', { hasText: 'Write a summary of each call' }).getByRole('switch').click();
await wait(300);
await page.locator('.suAction', { hasText: 'Write a summary of each call' }).locator('textarea').fill('Why they called and what to follow up.');
await page.getByRole('button', { name: 'Was the caller’s problem solved?' }).click();
await page.getByRole('button', { name: 'Why did they get in touch?' }).click();
await wait(300);
await page.locator('.suAction', { hasText: 'Recording' }).getByLabel('Keep the transcript').check();
await page.locator('.suAction', { hasText: 'Recording' }).getByLabel('Delete audio and transcripts after, in days').fill('30');
await page.locator('.suAction', { hasText: 'Recording' }).locator('.suField', { hasText: 'Recording notice' }).locator('input').fill('This call is recorded.');
// hiding is off until it is switched on (an agent that never set it doesn't hide anything, as the release checklist says)
const hiding = page.locator('.suAction', { hasText: 'Hide sensitive details' }).getByRole('switch');
check('hiding sensitive details shows off until it is switched on', (await hiding.getAttribute('aria-checked')) === 'false');
await hiding.click();
await wait(300);
await page.locator('.suAction', { hasText: 'Hide sensitive details' }).getByLabel('Card numbers').check();
await page.locator('.suAction', { hasText: 'Hide sensitive details' }).getByLabel('PINs').check();
await wait(500);
const formRows = await page.locator('.stForm .stFGroupToggle strong').allInnerTexts();
check(
  'the settings below no longer ask for the recording or the questions',
  !formRows.some((t) => /^Recording$|^Call analysis$/.test(t)),
  formRows.join(' | '),
);
if (OUT) {
  await page.locator('.suAction', { hasText: 'Recording' }).scrollIntoViewIfNeeded();
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
await page.locator('.nlRow', { hasText: 'Personality and rules' }).click();
await wait(1500);
const persona = await page.locator('.nlDrawer').innerText();
check(
  'the personality panel no longer asks for tone, style rules or the recording notice',
  !/Tone of voice|Style rules|What callers are told/.test(persona),
  persona.slice(0, 200),
);
check('its name is the one it introduces itself by', /Name it introduces itself by/.test(persona));
await page.keyboard.press('Escape');
await wait(400);
await go('#/bots/acme-support/channels');
check('Channels has no phone transfers now', (await page.locator('.nlRow', { hasText: 'Phone transfers' }).count()) === 0);
check('Channels no longer asks for the recording notice', (await page.locator('.suField', { hasText: 'Recording notice' }).count()) === 0);
await page.locator('.nlRow', { hasText: 'Chat on your website' }).first().click();
await wait(1500);
const channel = await page.locator('.nlDrawer').innerText();
check(
  'a channel’s panel says where its first line is set, and does not ask it',
  /change it on the Agent page/.test(channel) && !/\nWhat it says\n/.test(channel),
);
await page.keyboard.press('Escape');
await wait(400);
await go('#/bots/acme-support/tools');
check('Tools has the phone transfers, beside the hand-over that uses them', (await page.locator('.nlRow', { hasText: 'Phone transfers' }).count()) === 1);
await go('#/bots/acme-support/workflow');
await page
  // the agent's block (the Start block above it says the greeting, which has the agent's name in it too)
  .locator('.wfNode.agent')
  .filter({ hasText: 'Acme Support' })
  .first()
  .click()
  .catch(() => {});
await wait(800);
// the first agent's instructions, changed in the Workflow's panel: they are the Agent page's too
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
  check('and the Agent page shows the same instructions', (await agentRole.count()) > 0 && (await agentRole.first().inputValue()) === newRole);
}
// ---- the paths that were broken once: a setting shown on a page with parts, a rule of one's own, numbers and lists typed as people type them
await go('#/bots/acme-support/workflow');
await page.locator('.wfNode.agent').filter({ hasText: 'Acme Support' }).first().click();
await wait(700);
await page.getByRole('button', { name: 'All settings for this subagent' }).click();
await wait(1600);
check(
  '“All settings for this subagent” opens the Workflow’s settings with the subagent shown',
  /^agents/.test(await page.evaluate(() => document.activeElement?.closest('[data-path]')?.dataset.path || '')),
);
await go('#/bots/acme-support/guardrails');
const own = page.locator('.nlSection', { hasText: 'All its hand-over and ending rules' });
const before = await own.locator('.nlRow').count();
await own.getByRole('button', { name: /Add a rule/ }).click();
await wait(400);
await page.locator('.stPickCard').first().click();
await wait(1200);
await page.locator('.nlDrawer').getByRole('button', { name: 'Done' }).click();
await wait(700);
check('a rule of one’s own can be added', (await own.locator('.nlRow').count()) === before + 1);
const tries = page.locator('.suAction', { hasText: 'When someone keeps going off topic' }).getByLabel('How many tries');
await tries.click();
await tries.press('Control+a');
await tries.press('Backspace');
await tries.type('5');
const longest = page.locator('.smLimit', { hasText: 'Longest call' }).locator('input');
await longest.click();
await longest.press('Control+a');
await longest.type('0.5');
await wait(300);
check('a box being typed in keeps what is typed (5 tries, half a minute)', (await tries.inputValue()) === '5' && (await longest.inputValue()) === '0.5');
await save();
g = (await draft()).guardrails;
check('…and they are kept as 5 tries and 30 seconds', g.topics?.on_off_topic?.max_strikes === 5 && g.limits?.max_call_duration_s === 30);
await go('#/bots/acme-support/aftercall');
const choices = page.locator('.smValues').first();
await choices.click();
await choices.press('Control+a');
await choices.type('Billing, Delivery, Returns');
check('a list typed with commas keeps them while typing', (await choices.inputValue()) === 'Billing, Delivery, Returns');
await save();
check('and Save straight after keeps the list', JSON.stringify((await draft()).post_call.analysis[1].values) === '["Billing","Delivery","Returns"]');

check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
console.log(failed ? `\n${failed} check(s) failed` : '\nall passed');
await browser.close();
process.exit(failed ? 1 : 0);
