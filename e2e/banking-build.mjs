// Banking inside the agents, outside the Test stage: Build › Tools makes any agent a banking agent in one step (and
// takes it out again), "Try a banking tool" runs a tool against a test session with sign-in on the secure keypad,
// the Create dialog's Banking assistant starter, Sandbox's sample banking agent, Settings' banking gateway and the
// release checks. Sandbox: the gateway in the browser answers. Live (the harness sets no BANKING_GATEWAY_URL): the
// same features work end to end on the mock bank, saved to the real API, and every screen says it is test data.
//   E2E_API_PORT=8492 E2E_WEB_PORT=5492 E2E_SHOTS=<dir> node e2e/banking-build.mjs
import path from 'node:path';
import { check, suite } from './support/harness.mjs';

const { page, context, base, step, finish, errors } = await suite('banking-build');
const shots = process.env.E2E_SHOTS;
const USER = { id: 'e2e', name: 'Test Person', email: 'test.person@example.com', initials: 'TP', role: 'admin' };

async function call(method, p, body) {
  const res = await fetch(`${base}/api${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const until = async (fn, message, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(message);
};
const shot = async (p, name) => {
  if (!shots) return;
  await p.waitForTimeout(400); // let a dialog finish opening
  await p.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
};
const section = (p) => p.locator('section[data-banking]');
const openTools = async (p, id) => {
  await p.goto(`${base}/agents/${id}/build/tools`, { timeout: 90_000 });
  await section(p).waitFor({ timeout: 30_000 });
  await section(p).locator('[data-banking-source]').first().waitFor({ timeout: 20_000 });
};
// What a Sandbox agent's draft is, read from the Sandbox API in the page.
const sandboxDraft = (p, id) =>
  p.evaluate(async (bot) => {
    const { getSandboxApi } = await import('/src/sandbox/sandboxApi.ts');
    return (await getSandboxApi().handle('GET', `/bots/${bot}/draft`)).body;
  }, id);
const roleIds = (config) => (config.agents?.items ?? []).map((r) => r.id);
const BANKING_ROLES = ['greeter', 'authenticator', 'accounts', 'cheques', 'rates_info', 'appointments', 'payments'];

// ---- Sandbox (its own browser, on Sandbox from the start) ---------------------------------------------------------------
const sandboxContext = async (theme = 'light') => {
  const ctx = await context.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(
    ({ u, t }) => {
      sessionStorage.setItem('weave_auth_user', JSON.stringify(u));
      localStorage.setItem('weave_theme', t);
      localStorage.setItem('weave_data_source', 'sandbox');
    },
    { u: USER, t: theme }
  );
  return ctx;
};
const sbx = await sandboxContext();
const sb = await sbx.newPage();
sb.on('pageerror', (e) => errors.push(`sandbox page error: ${e.message}`));
sb.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`sandbox console: ${m.text()}`);
});

await step('Sandbox: the sample “Weave Bank assistant” is among the agents, marked Sample', async () => {
  await sb.goto(`${base}/agents`);
  await sb.getByRole('heading', { level: 1, name: 'Agents' }).waitFor();
  await until(async () => /Weave Bank assistant/.test(await sb.locator('main').innerText()), 'the sample banking agent is not listed');
  await until(async () => (await sb.locator('[data-sample-tag]').count()) === 4, 'four Sample tags');
});

await step('Sandbox: the sample is a complete banking agent, and its Build › Tools says the gateway in this browser answers', async () => {
  await openTools(sb, 'weave-bank');
  const s = section(sb);
  check((await s.getAttribute('data-banking')) === 'on', 'it is a banking agent');
  const text = await s.innerText();
  check(/Sandbox · banking gateway in this browser, mock bank systems/.test(text), `the source is named: ${text}`);
  check(/7 banking roles, 33 banking tools\. The banking front desk answers first\./.test(text), text);
  const chips = await s.getByRole('list', { name: 'Banking roles' }).locator('li').allInnerTexts();
  check(chips.length === 7 && chips.every((c) => Number(/(\d+) tools/.exec(c)?.[1]) <= 8), `seven roles, at most 8 tools each: ${chips}`);
  check(!(await s.getByRole('textbox').count()) && !/Gateway address|Set address|banking_gateway_url/.test(text), 'no address to type: Studio fills it in');
  const draft = await sandboxDraft(sb, 'weave-bank');
  check(BANKING_ROLES.every((id) => roleIds(draft.config).includes(id)) && draft.config.agents.entry === 'greeter', 'the seven roles, the front desk first');
  check(draft.config.channels.some((c) => c.type === 'web_chat' && c.enabled) && draft.config.channels.some((c) => c.type === 'web_voice' && c.enabled), 'web chat and web voice');
  await shot(sb, 'build-tools-banking-sandbox-light');
});

await step('Sandbox: “Make this a banking agent” makes an existing agent a complete banking agent in one step', async () => {
  const before = (await sandboxDraft(sb, 'bookings')).config;
  await openTools(sb, 'bookings');
  check((await section(sb).getAttribute('data-banking')) === 'off', 'Bookings is not a banking agent yet');
  await section(sb).getByRole('button', { name: 'Make this a banking agent' }).click();
  await section(sb).getByText(/This is now a banking agent: 33 tools added, 7 roles added\./).waitFor();
  check((await section(sb).getAttribute('data-banking')) === 'on', 'the section shows the banking agent');
  check(/Bookings takes questions that are not banking/.test(await section(sb).innerText()), 'its own role is kept for the rest');
  await sb.getByRole('button', { name: 'Save', exact: true }).click();
  await until(async () => (await sandboxDraft(sb, 'bookings')).config.agents.entry === 'greeter', 'the saved draft has the front desk first');
  const config = (await sandboxDraft(sb, 'bookings')).config;
  check(BANKING_ROLES.every((id) => roleIds(config).includes(id)) && roleIds(config).includes(before.agents.entry), 'six banking roles beside its own');
  check(config.connections?.banking_gateway?.type === 'http', 'the connection');
  check(JSON.stringify(config.events.map((e) => e.on)).includes('call_started') && JSON.stringify(config.events.map((e) => e.on)).includes('call_ended'), 'the session events');
  check(!!config.state.variables.call_id, 'the call_id state variable');
  const greeter = config.agents.items.find((r) => r.id === 'greeter');
  check(greeter.handoffs.map((h) => h.to).join() === `authenticator,accounts,cheques,rates_info,appointments,payments,${before.agents.entry}`, 'the front desk hands off to every specialist and the agent’s own role');
  check(greeter.instructions.rules.some((r) => /Never ask for a PIN, NRIC, one-time password/.test(r)) && greeter.instructions.rules.some((r) => /Do what next says/.test(r)), 'the design rules are in its instructions');
  check(config.agents.items.find((r) => r.id === 'cheques').instructions.rules.some((r) => /prepare_ tool, then confirm_transaction/.test(r)), 'writes are prepare then confirm');
});

await step('Sandbox: making it again changes nothing', async () => {
  await section(sb).getByRole('button', { name: 'Refresh banking tools' }).click();
  await section(sb).getByText('The draft already has the current banking roles and tools. Nothing changed.').waitFor();
  check(await sb.getByRole('button', { name: 'Save', exact: true }).isDisabled(), 'nothing to save');
});

let generated = null;
await step('Sandbox: “Remove banking” asks, then restores the agent it was', async () => {
  const before = await sb.evaluate(async () => {
    const { getSandboxApi } = await import('/src/sandbox/sandboxApi.ts');
    const { gateway } = await import('/src/api/gateway.ts');
    return { generated: await gateway.agentConfig(), versions: (await getSandboxApi().handle('GET', '/bots/bookings/versions')).body };
  });
  generated = before.generated;
  await section(sb).getByRole('button', { name: 'Remove banking' }).click();
  const ask = section(sb).getByRole('group', { name: 'Remove banking from this agent?' });
  check(/Bookings answers first again/.test(await ask.innerText()), await ask.innerText());
  await ask.getByRole('button', { name: 'Remove' }).click();
  await until(async () => (await section(sb).getAttribute('data-banking')) === 'off', 'the section is back to not banking');
  await section(sb).getByRole('button', { name: 'Make this a banking agent' }).waitFor();
  await sb.getByRole('button', { name: 'Save', exact: true }).click();
  await until(async () => !roleIds((await sandboxDraft(sb, 'bookings')).config).includes('greeter'), 'the saved draft has no banking roles');
  const config = (await sandboxDraft(sb, 'bookings')).config;
  check(!config.connections?.banking_gateway && !(config.tools ?? []).some((t) => t.connection === 'banking_gateway'), 'no banking tools or connection');
  check(config.agents.entry === config.agents.items[0].id && config.agents.items.length === 1, `its own role answers first again: ${roleIds(config)}`);
});

/** "Try a banking tool" on an agent's Build › Tools: a test session named by `sessionLabel`, sign-in with the mock bank's
 * test login on the secure keypad, then a balance the model reads with no full account number. */
async function tryBankingTool(p, id, sessionLabel) {
  await openTools(p, id);
  await section(p).locator('[data-banking-try] summary').click();
  const tryIt = section(p).locator('[data-banking-try]');
  await tryIt.getByRole('button', { name: 'Start a test session' }).click();
  await tryIt.getByText(sessionLabel).waitFor({ timeout: 20_000 });
  const tool = tryIt.getByLabel('Tool', { exact: true });
  await until(async () => (await tool.locator('option').count()) === 33, 'the 33 tools are offered');
  await tool.selectOption('start_authentication');
  await tryIt.getByLabel(/^phone_code/).fill('1234567');
  await tryIt.getByRole('button', { name: 'Run as the agent' }).click();
  const keypad = tryIt.getByLabel(/Key in your/);
  await keypad.waitFor({ timeout: 15_000 });
  await keypad.pressSequentially('135790');
  await tryIt.getByRole('button', { name: 'Submit' }).click();
  await keypad.waitFor({ state: 'detached', timeout: 15_000 });
  await tool.selectOption('get_auth_status');
  await tryIt.getByRole('button', { name: 'Run as the agent' }).click();
  const answer = tryIt.getByRole('region', { name: /Agent.s side/ }).locator('pre');
  await answer.waitFor();
  check(/"status": "authenticated"/.test(await answer.innerText()), `the caller is signed in: ${await answer.innerText()}`);
  await tool.selectOption('get_balance');
  await tryIt.getByLabel(/^account_ref/).fill('A1');
  await tryIt.getByRole('button', { name: 'Run as the agent' }).click();
  await tryIt.getByText('The agent reads:').waitFor({ timeout: 15_000 });
  const result = await answer.innerText();
  check(/"ok": true/.test(result) && !/\b\d{12}\b/.test(result), 'a balance, with no full account number for the model');
}

await step('Sandbox: “Try a banking tool” signs in on the secure keypad and runs a tool as the agent', async () => {
  await tryBankingTool(sb, 'weave-bank', /Test session · Sandbox · banking gateway in this browser/);
  await shot(sb, 'try-a-banking-tool-sandbox-light');
});

await step('Sandbox: Settings says which gateway answers and lists the gateway’s own test logins', async () => {
  await sb.goto(`${base}/settings`);
  const s = sb.locator('section[aria-labelledby="banking-gateway"]');
  await s.getByRole('heading', { name: 'Banking gateway' }).waitFor();
  await s.getByLabel('Test logins').waitFor({ timeout: 20_000 });
  const text = await s.innerText();
  check(/Sandbox · banking gateway in this browser/.test(text), text);
  check(/1234567/.test(text) && /BANKING_GATEWAY_TOKEN/.test(text), 'test logins and what deploying needs');
  check(!/Mock Bank Systems|Live Gateway/.test(text), 'the old labels are gone');
  await s.scrollIntoViewIfNeeded();
  await shot(sb, 'settings-banking-sandbox-light');
});

await step('Sandbox: the Banking assistant starter creates a banking agent on web chat and web voice', async () => {
  await sb.goto(`${base}/agents`);
  await sb.getByRole('button', { name: 'Create agent' }).first().click();
  const create = sb.getByRole('dialog', { name: 'Create an agent' });
  const card = create.locator('[data-starter="banking_assistant"]');
  await card.locator('[data-banking-reason]').waitFor({ timeout: 20_000 });
  check(await card.isEnabled(), 'the starter can be chosen');
  check(/in this browser/.test(await card.innerText()), 'it says where banking answers come from');
  await card.click();
  await create.getByLabel('Agent name').fill('Branch banking');
  await create.getByRole('button', { name: 'Create agent' }).click();
  await sb.waitForURL(/\/agents\/branch-banking\/setup/, { timeout: 30_000 });
  const { config } = await sandboxDraft(sb, 'branch-banking');
  check(config.agents.entry === 'greeter' && BANKING_ROLES.every((id) => roleIds(config).includes(id)), `a banking agent: ${roleIds(config)}`);
  check((config.tools ?? []).filter((t) => t.connection === 'banking_gateway').length === 33, '33 banking tools');
  check(config.channels.some((c) => c.type === 'web_chat' && c.enabled) && config.channels.some((c) => c.type === 'web_voice' && c.enabled), 'web chat and web voice');
});

await step('Sandbox: deploying a banking agent says plainly what the Agent Builder server needs', async () => {
  await sb.evaluate(async () => {
    const { getSandboxApi } = await import('/src/sandbox/sandboxApi.ts');
    await getSandboxApi().handle('POST', '/bots/weave-bank/publish', {});
  });
  await sb.goto(`${base}/agents/weave-bank/release`);
  await sb.locator('[data-version="0.1.0"]').getByRole('button', { name: 'Deploy', exact: true }).click({ timeout: 30_000 });
  const d = sb.getByRole('dialog', { name: 'Deploy a version' });
  const line = d.locator('[data-check="banking"]');
  await line.waitFor({ timeout: 20_000 });
  check(/Banking: No gateway address yet/.test(await line.innerText()) && /Refresh banking tools/.test(await line.innerText()), await line.innerText());
  await d.getByRole('button', { name: 'Deploy 0.1.0 to Development' }).click();
  const note = sb.locator('[data-deploy-note="banking"]');
  await note.waitFor({ timeout: 20_000 });
  check(/BANKING_GATEWAY_TOKEN/.test(await note.innerText()) && /reachable from the agent runtime/.test(await note.innerText()), await note.innerText());
  await sb.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
});

await step('Sandbox: “Start the sample data again” brings the sample banking agent back as it was', async () => {
  await sb.evaluate(async () => {
    const { getSandboxApi } = await import('/src/sandbox/sandboxApi.ts');
    const api = getSandboxApi();
    const draft = (await api.handle('GET', '/bots/weave-bank/draft')).body;
    await api.handle('PUT', '/bots/weave-bank/draft', { config: { ...draft.config, tools: [], connections: {} }, base_revision: draft.revision });
  });
  await sb.goto(`${base}/settings`);
  await sb.locator('main').getByRole('button', { name: 'Start the sample data again' }).click();
  const confirm = sb.getByRole('dialog', { name: 'Start the sample data again?' });
  await Promise.all([sb.waitForEvent('load', { timeout: 30_000 }).catch(() => undefined), confirm.getByRole('button', { name: /Start again/ }).click()]);
  await until(async () => {
    const draft = await sandboxDraft(sb, 'weave-bank');
    return (draft.config.tools ?? []).filter((t) => t.connection === 'banking_gateway').length === 33;
  }, 'the sample banking agent is made again');
});

// ---- Live (the suite's own browser; the harness sets no BANKING_GATEWAY_URL): banking works end to end on the mock bank,
// the same as in Sandbox, saved to the real API, and every screen says the answers are test data ---------------------------
const LIVE_MOCK = /Mock bank · banking gateway in this browser, test data only\. No banking gateway on the bank’s real systems is connected, so banking in Live uses the mock bank/;
const liveDraft = async (id) => (await call('GET', `/bots/${id}/draft`)).config;
/** Says "Mock bank", and never claims the bank's real systems, "not available" or Sandbox. */
const saysMockBank = async (locator, where) => {
  const text = await locator.innerText();
  check(/Mock bank/.test(text), `${where} does not say Mock bank: ${text.slice(0, 300)}`);
  const wrong = /Bank’s real systems|gateway · the bank’s real systems|Not available in Live|Sandbox · /.exec(text);
  check(!wrong, `${where} says “${wrong?.[0]}”`);
};

await step('Live: Build › Tools says the mock bank (test data) and why, and makes an agent a banking agent saved to the real API, its gateway address filled in with nothing typed', async () => {
  // the address this Studio server would give (BANKING_GATEWAY_URL); the harness runs none, so it is answered here
  await page.route('**/gateway/_studio/address', (route) => route.fulfill({ json: { address: 'https://gateway.bank.example' } }));
  await openTools(page, 'acme-support');
  const s = section(page);
  check(LIVE_MOCK.test(await s.innerText()) && /Mock bank · test data/.test(await s.innerText()), await s.innerText());
  await saysMockBank(s, 'Build › Tools');
  await s.getByRole('button', { name: 'Make this a banking agent' }).click();
  await s.getByText(/This is now a banking agent: 33 tools added, 7 roles added\./).waitFor();
  check((await s.getAttribute('data-banking')) === 'on', 'the section shows the banking agent');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await until(async () => (await liveDraft('acme-support')).agents?.entry === 'greeter', 'the saved Live draft has the front desk first');
  const config = await liveDraft('acme-support');
  check(BANKING_ROLES.every((id) => roleIds(config).includes(id)), `six banking roles: ${roleIds(config)}`);
  check((config.tools ?? []).filter((t) => t.connection === 'banking_gateway').length === 33, '33 banking tools');
  check(config.constants?.banking_gateway_url === 'https://gateway.bank.example', `the address is filled in: ${config.constants?.banking_gateway_url}`);
  check(!(await section(page).getByRole('textbox').count()), 'nothing to type');
  await page.unroute('**/gateway/_studio/address');
  await shot(page, 'build-tools-banking-live-light');
});

await step('Live: “Try a banking tool” signs in with a test login on the secure keypad and runs a tool, on the mock bank', async () => {
  await tryBankingTool(page, 'acme-support', /Test session · Mock bank · banking gateway in this browser, test data only/);
  await saysMockBank(section(page).locator('[data-banking-try]'), 'Try a banking tool');
  await shot(page, 'try-a-banking-tool-live-light');
});

await step('Live: Settings says the mock bank and why, what deploying needs, and lists the mock bank’s test logins', async () => {
  await page.goto(`${base}/settings`);
  const s = page.locator('section[aria-labelledby="banking-gateway"]');
  await s.locator('[data-banking-source]').waitFor({ timeout: 20_000 });
  await s.getByLabel('Test logins').waitFor({ timeout: 20_000 });
  const text = await s.innerText();
  check(LIVE_MOCK.test(text) && /Mock bank · test data/.test(text) && /BANKING_GATEWAY_TOKEN/.test(text), text);
  check(/1234567/.test(text) && /From the mock bank: test data only, never a real customer/.test(text), 'the test logins, said to be the mock bank’s');
  await saysMockBank(s, 'Settings');
  await s.scrollIntoViewIfNeeded();
  await shot(page, 'settings-banking-live-light');
});

await step('Live: the Banking assistant starter says the mock bank, and creates a banking agent on the real API', async () => {
  await page.goto(`${base}/agents`);
  await page.getByRole('button', { name: 'Create agent' }).first().click();
  const create = page.getByRole('dialog', { name: 'Create an agent' });
  const card = create.locator('[data-starter="banking_assistant"]');
  await card.locator('[data-banking-reason]').waitFor({ timeout: 20_000 });
  check(await card.isEnabled(), 'the starter can be chosen');
  check(LIVE_MOCK.test(await card.innerText()), await card.innerText());
  await shot(page, 'create-banking-starter-live-light');
  await card.click();
  await create.getByLabel('Agent name').fill('Live banking');
  await create.getByRole('button', { name: 'Create agent' }).click();
  await page.waitForURL(/\/agents\/live-banking\/setup/, { timeout: 30_000 });
  await until(async () => (await liveDraft('live-banking')).agents?.entry === 'greeter', 'the new agent is a banking agent on the real API');
  const config = await liveDraft('live-banking');
  check(BANKING_ROLES.every((id) => roleIds(config).includes(id)) && (config.tools ?? []).filter((t) => t.connection === 'banking_gateway').length === 33, 'seven roles and 33 tools');
  check(config.channels.some((c) => c.type === 'web_chat' && c.enabled) && config.channels.some((c) => c.type === 'web_voice' && c.enabled), 'web chat and web voice');
});

await step('Live: there is no sample banking agent', async () => {
  const bots = await call('GET', '/bots');
  check(!bots.some((b) => b.id === 'weave-bank'), 'the Live API has no sample banking agent');
  await page.goto(`${base}/agents`);
  await page.getByRole('heading', { level: 1, name: 'Agents' }).waitFor();
  await until(async () => /Acme Support/.test(await page.locator('main').innerText()), 'the agents are listed');
  check(!/Weave Bank assistant/.test(await page.locator('main').innerText()), 'no Weave Bank assistant in Live');
});

await step('Live: a banking agent saved elsewhere can be refreshed, and “Remove banking” takes it out again', async () => {
  // A banking agent saved by someone else (the gateway's generated config, laid on by the same model).
  const draft = await call('GET', '/bots/front-desk/draft');
  const made = await page.evaluate(
    async ({ config, gen }) => (await import('/src/models/bankingAgent.ts')).makeBankingAgent(config, gen, { gatewayUrl: 'https://gateway.bank.example' }).config,
    { config: draft.config, gen: generated }
  );
  await call('PUT', '/bots/front-desk/draft', { config: made, base_revision: draft.revision });
  await openTools(page, 'front-desk');
  const s = section(page);
  check((await s.getAttribute('data-banking')) === 'on', 'it is a banking agent');
  await saysMockBank(s, 'a banking agent in Live');
  await s.getByRole('button', { name: 'Refresh banking tools' }).click();
  await s.getByText('The draft already has the current banking roles and tools. Nothing changed.').waitFor();
  await s.getByRole('button', { name: 'Remove banking' }).click();
  await s.getByRole('group', { name: 'Remove banking from this agent?' }).getByRole('button', { name: 'Remove' }).click();
  await until(async () => (await s.getAttribute('data-banking')) === 'off', 'banking removed');
  check(!/greeter/.test(await page.locator('main').innerText()), 'the banking roles are gone');
});

await step('Live: a banking agent made by an older Studio (the same hand-off in several roles) is repaired in one click, and saves clean', async () => {
  const draft = await call('GET', '/bots/front-desk/draft');
  const broken = await page.evaluate(
    async ({ config, gen }) => {
      const made = (await import('/src/models/bankingAgent.ts')).makeBankingAgent(config, gen, { gatewayUrl: 'https://gateway.bank.example' }).config;
      const old = (to, tool) => ({ id: `to_${to}`, tool, description: 'old', to, carry_context: true });
      const items = made.agents.items.map((r) => (['accounts', 'cheques', 'appointments'].includes(r.id) ? { ...r, handoffs: [old('authenticator', 'go_to_sign_in'), old('greeter', 'back_to_menu')] } : r));
      return { ...made, agents: { ...made.agents, items } };
    },
    { config: draft.config, gen: generated }
  );
  await call('PUT', '/bots/front-desk/draft', { config: broken, base_revision: draft.revision });
  await openTools(page, 'front-desk');
  const repair = section(page).locator('[data-banking-repair]');
  await repair.waitFor({ timeout: 20_000 });
  check(/hand-offs share a name/.test(await repair.innerText()), await repair.innerText());
  await repair.getByRole('button', { name: 'Repair banking hand-offs' }).click();
  await repair.waitFor({ state: 'detached', timeout: 20_000 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await until(async () => {
    const items = (await liveDraft('front-desk')).agents.items;
    const all = items.flatMap((r) => r.handoffs ?? []);
    return all.length > 10 && new Set(all.map((h) => h.id)).size === all.length && new Set(all.map((h) => h.tool)).size === all.length;
  }, 'the saved draft has a unique id and tool name for every hand-off');
});

await step('Live: the release checks warn (without blocking) that it was tested on the mock bank, and name the address a deploy uses', async () => {
  // put the banking config back, publish it, and look at its deploy checks
  const draft = await call('GET', '/bots/front-desk/draft');
  const made = await page.evaluate(
    async ({ config, gen }) => (await import('/src/models/bankingAgent.ts')).makeBankingAgent(config, gen, { gatewayUrl: 'https://gateway.bank.example' }).config,
    { config: draft.config, gen: generated }
  );
  await call('PUT', '/bots/front-desk/draft', { config: made, base_revision: draft.revision });
  const published = await call('POST', '/bots/front-desk/publish', {});
  await page.goto(`${base}/agents/front-desk/release`);
  await page.locator(`[data-version="${published.version}"]`).getByRole('button', { name: 'Deploy', exact: true }).click({ timeout: 30_000 });
  const d = page.getByRole('dialog', { name: 'Deploy a version' });
  const line = d.locator('[data-check="banking"]');
  await line.waitFor({ timeout: 20_000 });
  const text = await line.innerText();
  check(/Banking: Tested on the mock bank \(test data\)/.test(text) && LIVE_MOCK.test(text) && /BANKING_GATEWAY_TOKEN/.test(text), text);
  check(/https:\/\/gateway\.bank\.example/.test(text), 'it names the address a deployed agent reaches');
  check(await d.getByRole('button', { name: new RegExp(`^Deploy ${published.version.replace(/\./g, '\\.')} to`) }).isEnabled(), 'the deploy is not blocked');
  await shot(page, 'deploy-banking-live-light');
  await d.getByRole('button', { name: 'Cancel' }).click();
});

// ---- dark pictures -------------------------------------------------------------------------------------------------------
await step('dark: the banking section, the starter and Settings read in the dark theme', async () => {
  if (!shots) return;
  const dark = await sandboxContext('dark');
  const p = await dark.newPage();
  await openTools(p, 'weave-bank');
  await shot(p, 'build-tools-banking-sandbox-dark');
  await p.goto(`${base}/settings`);
  await p.locator('section[aria-labelledby="banking-gateway"]').getByLabel('Test logins').waitFor({ timeout: 20_000 });
  await shot(p, 'settings-banking-sandbox-dark');
  await dark.close();
  const liveDark = await context.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await liveDark.addInitScript((u) => {
    sessionStorage.setItem('weave_auth_user', JSON.stringify(u));
    localStorage.setItem('weave_theme', 'dark');
  }, USER);
  const lp = await liveDark.newPage();
  await openTools(lp, 'acme-support');
  await shot(lp, 'build-tools-banking-live-dark');
  await lp.goto(`${base}/agents`);
  await lp.getByRole('button', { name: 'Create agent' }).first().click();
  await lp.getByRole('dialog', { name: 'Create an agent' }).locator('[data-starter="banking_assistant"] [data-banking-reason]').waitFor({ timeout: 20_000 });
  await shot(lp, 'create-banking-starter-live-dark');
  await liveDark.close();
});

await sbx.close();
await finish();
