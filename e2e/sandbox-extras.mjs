// Sandbox's extras, and the Live | Sandbox switch itself, in a real browser against the stand-in API:
//   - the switch: Live by default; switching asks first and reloads onto the sample agents; the choice survives a
//     reload; another tab follows; "Start the sample data again" puts the samples back; back in Live, only the API's
//     agents are shown;
//   - Live shows none of Sandbox's extras, and an answer of an unexpected shape is an error naming the field (W41);
//   - Sandbox: "Sample" tags and hiding them on Home, the sample team, "Describe it" by built-in rules (no AI model),
//     the browser's own voice for a recording that can't be played, Settings' Data source card, the sign-in hint.
//   E2E_API_PORT=8473 E2E_WEB_PORT=5473 node e2e/sandbox-extras.mjs
import { check, suite } from './support/harness.mjs';

const { page, context, base, step, finish, errors } = await suite('sandbox-extras');
const API = `http://127.0.0.1:${Number(process.env.E2E_API_PORT || 8400)}`;
const USER = { id: 'e2e', name: 'Test Person', email: 'test.person@example.com', initials: 'TP', role: 'admin' };
const SAMPLES = ['Acme Support', 'Front Desk', 'Bookings', 'Weave Bank assistant'];

// The browser's speech, stood in for so what is read aloud (and in which voice) can be checked.
const speechStandIn = () => {
  window.__spoken = [];
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  const synth = {
    getVoices: () => [
      { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true },
      { name: 'Microsoft Zira - English (United States)', lang: 'en-US', localService: true },
    ],
    speak: (u) => {
      window.__spoken.push({ text: u.text, voice: u.voice?.name ?? null });
      setTimeout(() => u.onend?.(), 300);
    },
    cancel: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
};
await context.addInitScript(speechStandIn);

// The voice recordings are somebody else's server: here they can't be loaded.
const failSamples = (ctx) =>
  ctx.route(
    (url) => /storage\.googleapis\.com|elevenlabs\.io|creativeclaw\.co|\.mp3$/.test(url.href) && !url.href.includes('localhost'),
    (route) => route.fulfill({ status: 404, body: '' })
  );

const header = (p = page) => p.getByRole('group', { name: 'Data source' });
const pressed = async (p, label) => (await header(p).getByRole('button', { name: label }).getAttribute('aria-pressed')) === 'true';
const mainText = (p = page) => p.locator('main').innerText();
const until = async (fn, message, timeout = 15_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(message);
};
const openAgents = async (p = page) => {
  await p.goto(`${base}/agents`);
  await p.getByRole('heading', { level: 1, name: 'Agents' }).waitFor();
  await until(async () => /Acme Support|Front Desk|Bookings|Live Only Agent|Made Here|removed from your list|Couldn’t read/i.test(await mainText(p)), 'the agents were not listed');
};

// An agent only the API (Live) has, so Live and Sandbox can be told apart.
await fetch(`${API}/bots`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'live-only', name: 'Live Only Agent' }) });

// ---- Live: the default, and none of Sandbox's extras --------------------------------------------------------------------
await step('Live by default: the header says Live, the agents are the API’s, and none is marked Sample', async () => {
  await openAgents();
  check(await pressed(page, 'Live'), 'Live is pressed');
  check(!(await pressed(page, 'Sandbox')), 'Sandbox is not pressed');
  check(/Live Only Agent/.test(await mainText()), 'the API’s own agent is listed');
  check((await page.locator('[data-sample-tag]').count()) === 0, 'no agent is marked Sample');
});

await step('Live: Home has no sample notice, Team no sample people, and Settings says Live is in use', async () => {
  await page.goto(`${base}/`);
  await page.getByTestId('home-counts').waitFor();
  await until(async () => !/Reading your agents/.test(await page.getByTestId('home-counts').innerText()), 'Home did not read the agents');
  check((await page.getByTestId('sample-agents').count()) === 0, 'no sample notice on Home');
  check((await page.locator('[data-sample-tag]').count()) === 0, 'no Sample tag on Home');
  await page.goto(`${base}/team`);
  await page.getByRole('heading', { level: 1, name: 'Team' }).waitFor();
  await page.waitForTimeout(500);
  check((await page.getByTestId('team-samples').count()) === 0, 'no sample team note');
  check(!/Priya Shah|Marco Rossi|Dana Lee/.test(await mainText()), 'no sample people');
  await page.goto(`${base}/settings`);
  const card = page.getByTestId('data-source');
  await card.waitFor();
  check((await card.locator('[data-source="live"][aria-current="true"]').count()) === 1, 'Live is in use');
  check(!/Start the sample data again/.test(await card.innerText()), 'nothing to start again in Live');
  check(/Connected|Checking|Not checked/.test(await page.getByTestId('api-state').innerText()), 'the API’s state is the server’s');
});

await step('Live: Describe it doesn’t offer the built-in rules', async () => {
  await page.goto(`${base}/agents/acme-support/build`);
  await page.getByRole('button', { name: 'Describe it' }).click();
  const dialog = page.getByRole('dialog', { name: 'Describe it' });
  await dialog.getByText('No AI model is set up on this Studio server').waitFor({ timeout: 15_000 });
  check(!/Built-in rules|first draft/i.test(await dialog.innerText()), 'no rules are offered');
  await page.keyboard.press('Escape');
});

await step('Live: a recording that can’t be loaded is said, and no browser voice reads it instead', async () => {
  await failSamples(page);
  await page.goto(`${base}/library`);
  await page.getByRole('heading', { name: 'Library', level: 1 }).waitFor();
  await page.locator('[data-voice="elevenlabs-sarah"]').getByRole('button', { name: 'Listen to Sarah' }).click();
  await page.getByText('Couldn’t play the sample').first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
  check((await page.evaluate(() => window.__spoken.length)) === 0, 'nothing was read aloud');
  check((await page.locator('[data-voice-note]').count()) === 0, 'no browser-voice note');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

await step('Live: an answer of an unexpected shape is an error that names the field', async () => {
  await page.route('**/api/bots/acme-support/calls?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ calls: 'none', next: null }) })
  );
  await page.goto(`${base}/agents/acme-support/monitor`);
  await page.getByText(/Could not load the calls/).waitFor({ timeout: 15_000 });
  const said = await mainText();
  check(said.includes('The server sent something unexpected (GET /bots/acme-support/calls: calls should be an array).'), said.slice(0, 400));
  await page.unroute('**/api/bots/acme-support/calls?*');

  await page.route('**/api/bots', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bots: [] }) }) : route.continue()
  );
  await openAgents();
  const box = page.getByTestId('agents-error');
  await box.waitFor();
  check((await box.innerText()).includes('The server sent something unexpected (GET /bots: the answer should be an array).'), await box.innerText());
  await page.unroute('**/api/bots');
  await box.getByRole('button', { name: 'Read them again' }).click();
  await until(async () => /Live Only Agent/.test(await mainText()), 'the agents came back');
});

await step('Live: when the server can’t be reached, the strip also offers Sandbox, and asks first', async () => {
  await page.route('**/api/health', (route) => route.abort());
  try {
    await page.goto(`${base}/calls`);
    await page.getByText('Can’t reach the server.').waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Use Sandbox instead' }).click();
    const ask = page.getByRole('dialog', { name: 'Switch to Sandbox?' });
    await ask.waitFor();
    check(/sample agents and calls kept in this browser/i.test(await ask.innerText()), 'it says what Sandbox is');
    await ask.getByRole('button', { name: 'Cancel' }).click();
    check(await pressed(page, 'Live'), 'still Live');
    check((await page.evaluate(() => localStorage.getItem('weave_data_source'))) === null, 'nothing was switched');
  } finally {
    await page.unroute('**/api/health');
  }
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByText('Can’t reach the server.').waitFor({ state: 'detached', timeout: 15_000 });
});

// ---- the switch ----------------------------------------------------------------------------------------------------------
const other = await context.newPage();
await other.goto(`${base}/agents`);
await other.getByRole('heading', { level: 1, name: 'Agents' }).waitFor();

await step('switching to Sandbox asks first, then reloads onto the sample agents', async () => {
  await openAgents();
  await header().getByRole('button', { name: 'Sandbox' }).click();
  const ask = page.getByRole('dialog', { name: 'Switch to Sandbox?' });
  await ask.waitFor();
  check(await pressed(page, 'Live'), 'nothing changes before the answer');
  await Promise.all([page.waitForEvent('load'), ask.getByRole('button', { name: 'Use Sandbox' }).click()]);
  await page.getByRole('heading', { level: 1, name: 'Agents' }).waitFor();
  await until(async () => (await page.locator('[data-sample-tag]').count()) === 4, 'the four samples are not marked');
  check(await pressed(page, 'Sandbox'), 'Sandbox is pressed');
  const text = await mainText();
  check(SAMPLES.every((n) => text.includes(n)), 'the sample agents are listed');
  check(!/Live Only Agent/.test(text), 'the API’s own agent is not');
});

await step('another tab follows the switch', async () => {
  await until(async () => pressed(other, 'Sandbox'), 'the other tab did not follow');
  await until(async () => (await other.locator('[data-sample-tag]').count()) === 4, 'the other tab is not on the samples');
});

await step('the choice is kept after a reload', async () => {
  await page.reload();
  await page.getByRole('heading', { level: 1, name: 'Agents' }).waitFor();
  check(await pressed(page, 'Sandbox'), 'still Sandbox');
  await until(async () => (await page.locator('[data-sample-tag]').count()) === 4, 'still the samples');
});

await step('“Start the sample data again” puts the samples back and removes what was made here', async () => {
  // something made in Sandbox, and the samples hidden from Home
  await page.evaluate(async () => {
    const { getSandboxApi } = await import('/src/sandbox/sandboxApi.ts');
    await getSandboxApi().handle('POST', '/bots', { id: 'made-here', name: 'Made Here' });
  });
  await page.goto(`${base}/`);
  await page.getByTestId('sample-agents').getByRole('button', { name: 'Hide the samples' }).click();
  await page.getByTestId('sample-agents').waitFor({ state: 'detached' });
  await openAgents();
  await until(async () => /Made Here/.test(await mainText()), 'what was made is listed');

  await header().getByRole('button', { name: 'Sandbox' }).click();
  const box = page.getByRole('dialog', { name: 'You are in Sandbox' });
  await box.waitFor();
  await Promise.all([page.waitForEvent('load'), box.getByRole('button', { name: 'Start the sample data again' }).click()]);
  await openAgents();
  await until(async () => (await page.locator('[data-sample-tag]').count()) === 4, 'the samples are back on the list');
  check(!/Made Here/.test(await mainText()), 'what was made here is gone');
  await page.goto(`${base}/`);
  await page.getByTestId('sample-agents').waitFor();
  check(/These 4 agents are samples/.test(await page.getByTestId('sample-agents').innerText()), 'Home shows the four samples again');
});

await step('switching back to Live shows the real API’s agents only', async () => {
  await openAgents();
  await header().getByRole('button', { name: 'Live' }).click();
  const ask = page.getByRole('dialog', { name: 'Switch to Live?' });
  await ask.waitFor();
  await Promise.all([page.waitForEvent('load'), ask.getByRole('button', { name: 'Use Live' }).click()]);
  await openAgents();
  await until(async () => /Live Only Agent/.test(await mainText()), 'the API’s own agent is listed');
  check(await pressed(page, 'Live'), 'Live is pressed');
  check((await page.locator('[data-sample-tag]').count()) === 0, 'nothing is marked Sample');
  await until(async () => pressed(other, 'Live'), 'the other tab followed back');
  await other.close();
});

// ---- Sandbox's extras (a browser of its own, on Sandbox from the start) --------------------------------------------------
const sandboxContext = async ({ user = USER, theme = 'light' } = {}) => {
  const ctx = await context.browser().newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(
    ({ u, t }) => {
      if (u) sessionStorage.setItem('weave_auth_user', JSON.stringify(u));
      localStorage.setItem('weave_theme', t);
      localStorage.setItem('weave_data_source', 'sandbox');
    },
    { u: user, t: theme }
  );
  await ctx.addInitScript(speechStandIn);
  return ctx;
};
const sbx = await sandboxContext();
const sb = await sbx.newPage();
const asked = { api: [], llm: [] };
sb.on('request', (r) => {
  const path = new URL(r.url()).pathname;
  if (path.startsWith('/api/bots')) asked.api.push(path);
  if (path.startsWith('/llm')) asked.llm.push(path);
});
sb.on('pageerror', (e) => errors.push(`sandbox page error: ${e.message}`));
sb.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`sandbox console: ${m.text()}`);
});

await step('Sandbox: the four sample agents are marked Sample on the agent list', async () => {
  await openAgents(sb);
  await until(async () => (await sb.locator('[data-sample-tag]').count()) === 4, 'four Sample tags');
  check(await pressed(sb, 'Sandbox'), 'the header says Sandbox');
});

await step('Sandbox: Home says which agents are samples and hides them; Agents brings one back', async () => {
  await sb.goto(`${base}/`);
  const notice = sb.getByTestId('sample-agents');
  await notice.waitFor();
  const said = await notice.innerText();
  check(/These 4 agents are samples/.test(said) && SAMPLES.every((n) => said.includes(n)), said);
  check((await sb.locator('main [data-sample-tag]').count()) > 0, 'the agents on Home are tagged');
  await notice.getByRole('button', { name: 'Hide the samples' }).click();
  await notice.waitFor({ state: 'detached' });
  await until(async () => (await sb.locator('main [data-sample-tag]').count()) === 0, 'the samples left Home');
  await openAgents(sb);
  const removed = sb.locator('section[aria-labelledby="removed-agents-title"]');
  await removed.getByRole('button', { name: /Removed from your list \(4\)/ }).click();
  const removedText = await removed.innerText();
  check(SAMPLES.every((n) => removedText.includes(n)), `the samples are under Removed from your list: ${removedText}`);
  await removed.getByRole('button', { name: 'Restore' }).first().click();
  await sb.goto(`${base}/`);
  await until(async () => /This agent is a sample/.test(await sb.getByTestId('sample-agents').innerText()), 'the restored sample is back on Home');
});

await step('Sandbox: Team starts with the sample team, each person marked Sample', async () => {
  await sb.goto(`${base}/team`);
  await sb.getByTestId('team-samples').waitFor({ timeout: 15_000 });
  for (const name of ['Priya Shah', 'Marco Rossi', 'Dana Lee']) {
    const row = sb.locator('tr', { hasText: name });
    await row.waitFor();
    check(/Sample/.test(await row.innerText()), `${name} is marked Sample`);
  }
  check(!/Sample/.test(await sb.locator('tr[data-member="test.person@example.com"]').innerText()), 'the person signed in is not a sample');
  check(/4 people · 1 invited/.test(await sb.getByTestId('team-count').innerText()), await sb.getByTestId('team-count').innerText());
});

await step('Sandbox: Describe it uses built-in rules, says they are not AI, and asks no AI model', async () => {
  await sb.goto(`${base}/agents/bookings/build`);
  await sb.getByRole('button', { name: 'Describe it' }).click();
  const dialog = sb.getByRole('dialog', { name: 'Describe it' });
  await dialog.locator('[data-rules-note]').waitFor({ timeout: 15_000 });
  const note = await dialog.locator('[data-rules-note]').innerText();
  check(/Built-in rules, not AI/.test(note) && /not an AI model/.test(note), note);
  const box = dialog.getByLabel('What should change?');
  await box.fill('help people');
  check(await dialog.getByRole('button', { name: 'Make a first draft' }).isDisabled(), 'too short to read');
  await box.fill('A friendly receptionist for a dental clinic that books appointments by phone. Never give medical advice.');
  await dialog.getByRole('button', { name: 'Make a first draft' }).click();
  const proposal = dialog.getByRole('region', { name: 'Proposal' });
  await proposal.getByText(/A first draft of a Booking concierge agent/).waitFor({ timeout: 15_000 });
  check(/Built-in rules, not AI/.test(await proposal.innerText()), 'the proposal says who made it');
  await proposal.getByRole('button', { name: 'Apply' }).click();
  await proposal.getByText('Applied to the draft').waitFor();
  check(asked.llm.length === 0, `asked an AI model: ${asked.llm.join(', ')}`);
  await sb.keyboard.press('Escape');
});

await failSamples(sbx);
await step('Sandbox: in the Library, a voice whose recording can’t be loaded is read by the browser’s own voice, and says so', async () => {
  await sb.goto(`${base}/library`);
  await sb.getByRole('heading', { name: 'Library', level: 1 }).waitFor();
  await sb.locator('[data-voice="elevenlabs-sarah"]').getByRole('button', { name: 'Listen to Sarah' }).click();
  const note = sb.locator('[data-voice-note]');
  await note.waitFor({ timeout: 10_000 });
  const said = await note.innerText();
  check(/your browser’s voice/i.test(said) && /your browser’s own voice reading it, not Sarah/.test(said), said);
  const spoken = await sb.evaluate(() => window.__spoken);
  check(spoken.length === 1 && /Sarah/.test(spoken[0].text) && /Zira/.test(spoken[0].voice), JSON.stringify(spoken));
});

await step('Sandbox: the agent’s voice picker does the same', async () => {
  await sb.goto(`${base}/agents/acme-support/build/agent`);
  await sb.locator('main').getByRole('heading', { name: 'What it should do' }).waitFor({ timeout: 20_000 });
  await sb.locator('main').getByRole('button', { name: /^Voice:/ }).click();
  const panel = sb.getByRole('dialog', { name: 'Voice' });
  await panel.getByLabel('Search voices').fill('adam');
  await panel.getByRole('button', { name: 'Listen to Adam' }).click();
  const note = panel.locator('[data-voice-note]');
  await note.waitFor({ timeout: 10_000 });
  check(/your browser’s own voice reading it, not Adam/.test(await note.innerText()), await note.innerText());
  const spoken = await sb.evaluate(() => window.__spoken);
  check(/Adam/.test(spoken.at(-1)?.text) && /David/.test(spoken.at(-1)?.voice), JSON.stringify(spoken));
  await panel.getByRole('button', { name: 'Cancel' }).click();
});

await step('Sandbox: Settings’ Data source card says Sandbox is in use, and offers Live and starting again', async () => {
  await sb.goto(`${base}/settings`);
  const card = sb.getByTestId('data-source');
  await card.waitFor();
  check((await card.locator('[data-source="sandbox"][aria-current="true"]').count()) === 1, 'Sandbox is in use');
  await card.getByRole('button', { name: 'Use Live' }).click();
  const ask = sb.getByRole('dialog', { name: 'Switch to Live?' });
  await ask.waitFor();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await card.getByRole('button', { name: 'Start the sample data again' }).click();
  const again = sb.getByRole('dialog', { name: 'Start the sample data again?' });
  await again.waitFor();
  await again.getByRole('button', { name: 'Cancel' }).click();
  check(/Sandbox, no server/.test(await sb.getByTestId('api-state').innerText()), 'the API section says no server is asked');
});

await step('Sandbox asked the Agent Builder API nothing', async () => {
  check(asked.api.length === 0, `asked: ${[...new Set(asked.api)].slice(0, 5).join(', ')}`);
});

await step('the sign-in page says it is Sandbox (and Live’s says nothing of it)', async () => {
  const signedOut = await sandboxContext({ user: null });
  const p = await signedOut.newPage();
  await p.goto(`${base}/signin`);
  const hint = p.getByTestId('sandbox-signin');
  await hint.waitFor();
  check(/You’re in Sandbox/.test(await hint.innerText()) && /Enter any email and password/.test(await hint.innerText()), await hint.innerText());
  check(/Sandbox sign-in/i.test(await p.locator('body').innerText()), 'the card says Sandbox sign-in');
  await signedOut.close();
  const live = await context.browser().newContext();
  const lp = await live.newPage();
  await lp.goto(`${base}/signin`);
  await lp.getByRole('heading', { name: /Sign in to Weave Studio|Get started/ }).waitFor();
  check((await lp.getByTestId('sandbox-signin').count()) === 0, 'no Sandbox hint in Live');
  check(/Temporary sign-in/i.test(await lp.locator('body').innerText()), 'Live’s card is as before');
  await live.close();
});

await sbx.close();
await finish();
