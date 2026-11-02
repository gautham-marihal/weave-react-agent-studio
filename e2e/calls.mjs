// The Calls page, a call's page and the Test stage's trace, against the stand-in API (seeded calls, plus calls that are
// going on right now and are followed over the call stream).
//   E2E_API_PORT=8421 E2E_WEB_PORT=5421 node e2e/calls.mjs
import { check, suite } from './support/harness.mjs';

const { page, context, base, step, finish } = await suite('calls');
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });

// every GET /bots/{id}/calls the Calls page makes (it reads 25 at a time; the background alert check reads 100)
const listRequests = [];
page.on('request', (r) => {
  const url = new URL(r.url());
  if (/\/api\/bots\/[^/]+\/calls$/.test(url.pathname) && url.searchParams.get('limit') !== '100') listRequests.push(url);
});
const lastList = () => listRequests[listRequests.length - 1];
const rows = () => page.locator('tbody tr');
const waitRows = async () => page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 0, null, { timeout: 15_000 });
const settle = (ms = 700) => page.waitForTimeout(ms);
const apiJson = (path) => page.evaluate(async (p) => (await fetch(`/api${p}`)).json(), path);

await step('the Calls page lists calls from every agent', async () => {
  // the first visit waits for the dev server to build the app
  await page.goto(`${base}/calls`, { timeout: 120_000 });
  await page.getByRole('button', { name: 'Table' }).click();
  await waitRows();
  const agents = new Set(await page.locator('tbody tr td:nth-child(2)').allTextContents());
  check(agents.size >= 2, `calls of several agents: ${[...agents].join(', ')}`);
  check(listRequests.some((u) => u.searchParams.get('since')), 'the past 7 days are asked of the server (since=…)');
});

await step('the agent picker finds an agent by typing part of its name', async () => {
  await page.getByRole('button', { name: /^Agent:/ }).click();
  await page.getByRole('combobox', { name: 'Find an agent' }).fill('front');
  const found = await page.getByRole('listbox', { name: 'Agents' }).getByRole('option').allTextContents();
  check(found.length === 1 && found[0].startsWith('Front Desk'), `only Front Desk matches “front”: ${found.join(', ')}`);
  await page.keyboard.press('Enter');
  await page.waitForURL(/agent=front-desk/);
  await settle();
  const agents = new Set(await page.locator('tbody tr td:nth-child(2)').allTextContents());
  check(agents.size === 1 && agents.has('Front Desk'), [...agents].join(', '));
  check(lastList().pathname.includes('/bots/front-desk/calls'), 'only that agent is asked');
});

await step('the outcome is asked of the server as a status', async () => {
  await page.getByLabel('Outcome').selectOption('cut_off');
  await settle();
  check(lastList().searchParams.get('status') === 'unfinished', lastList().search);
  const chips = await page.locator('tbody tr td:last-child').allTextContents();
  check(chips.every((t) => /Cut off/.test(t)), chips.join(','));
  await page.getByLabel('Outcome').selectOption('handed_over');
  await settle();
  check(lastList().searchParams.get('status') === 'ended', 'handed over is “ended” to the server, told apart by hand-overs');
  await page.getByLabel('Outcome').selectOption('');
});

await step('the time range is asked of the server', async () => {
  await page.getByLabel('When').selectOption('all');
  await settle();
  check(!lastList().searchParams.get('since'), `all time sends no since: ${lastList().search}`);
  await page.getByLabel('When').selectOption('24h');
  await settle();
  const since = Date.parse(lastList().searchParams.get('since'));
  check(Math.abs(Date.now() - since - 24 * 3600e3) < 120e3, 'since is 24 hours ago');
  check(/range=24h/.test(page.url()), 'the range is in the address');
  await page.getByLabel('When').selectOption('7d');
});

await step('caller digits are asked of the server once typing stops', async () => {
  await page.getByLabel('Caller').fill('+65');
  await page.waitForFunction(() => /caller=%2B65/.test(location.search), null, { timeout: 5000 });
  await settle();
  check(lastList().searchParams.get('caller') === '+65', lastList().search);
  const callers = await page.locator('tbody tr td:nth-child(3) p:first-child').allTextContents();
  check(callers.every((c) => c.includes('+65')), callers.join(','));
  await page.getByLabel('Caller').fill('');
  await page.waitForFunction(() => !/caller=/.test(location.search), null, { timeout: 5000 });
});

await step('“Load more calls” asks for older calls by cursor', async () => {
  await page.goto(`${base}/calls?agent=acme-support&size=50`);
  await page.getByRole('button', { name: 'Table' }).click();
  await waitRows();
  const before = await rows().count();
  check(before === 25, `the first page of 25 (${before})`);
  await page.getByRole('button', { name: 'Load more calls' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('tbody tr').length > n, before, { timeout: 10_000 });
  check(lastList().searchParams.get('cursor') === '25', lastList().search);
  check((await page.getByRole('button', { name: 'Load more calls' }).count()) === 0, 'nothing more to load');
});

await step('the old list stays, dimmed, while a new one is read', async () => {
  await page.route('**/api/bots/*/calls?*', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue().catch(() => {});
  });
  await page.getByLabel('When').selectOption('30d');
  await page.waitForTimeout(300);
  const list = page.getByTestId('calls-list');
  check((await list.getAttribute('aria-busy')) === 'true', 'busy while reading');
  check(/opacity-50/.test(await list.getAttribute('class')), 'dimmed');
  check((await rows().count()) > 0, 'the old rows still show');
  await page.unroute('**/api/bots/*/calls?*');
  await page.waitForFunction(() => document.querySelector('[data-testid=calls-list]')?.getAttribute('aria-busy') !== 'true', null, { timeout: 10_000 });
});

await step('the environment filter, page size and accordion view are kept', async () => {
  await page.goto(`${base}/calls?env=test&size=5`);
  await page.locator('main').waitFor();
  await settle(1500);
  check((await page.getByLabel('Environment').inputValue()) === 'test', 'environment filter');
  await page.getByRole('button', { name: 'Table' }).click();
  check((await rows().count()) <= 5, 'five per page');
  const where = await page.locator('tbody tr td:nth-child(5)').allTextContents();
  check(where.every((w) => w.startsWith('Test')), where.join(','));
});

// ---------------------------------------------------------------- a call's page

let problemCall = null;
await step('a call opens from the list with its full trace', async () => {
  await page.goto(`${base}/calls?agent=acme-support&range=all`);
  await page.getByRole('button', { name: 'Table' }).click();
  await waitRows();
  await rows().first().click();
  await page.waitForURL(/\/calls\/[^?]+\?agent=acme-support/);
  await page.getByRole('region', { name: 'What happened' }).waitFor();
  check((await page.locator('[aria-label="Records"] li').count()) > 3, 'records are listed');
  check(/message/.test(await page.getByTestId('trace-summary').textContent()), 'a summary line');
  check(/records?:/.test(await page.locator('main').innerText()), 'the record counts in words');
  const href = await page.getByRole('link', { name: /Download NDJSON/ }).getAttribute('href');
  check(/\/calls\/.+\/download$/.test(href), href);
});

await step('the trace filters by kind', async () => {
  const group = page.getByRole('group', { name: 'Show only' });
  await group.getByRole('button', { name: /^Conversation/ }).click();
  const kinds = await page.locator('[aria-label="Records"] li').evaluateAll((all) => all.map((li) => li.dataset.kind));
  check(kinds.length > 0 && kinds.every((k) => k === 'user_said' || k === 'agent_said'), kinds.join(','));
  await group.getByRole('button', { name: 'Show all' }).click();
  check((await page.locator('[aria-label="Records"] li').count()) > kinds.length, 'everything again');
});

await step('raw fields open on request', async () => {
  await page.locator('[aria-label="Records"] li summary').first().click();
  check(/"seq"/.test(await page.locator('[aria-label="Records"] li pre').first().textContent()), 'the record as it was written');
});

await step('copy as text puts the trace on the clipboard', async () => {
  await page.getByRole('button', { name: 'Copy as text' }).click();
  await page.getByRole('button', { name: 'Copied' }).waitFor({ timeout: 3000 });
  const text = await page.evaluate(() => navigator.clipboard.readText());
  check(/Agent/.test(text) && /\d:\d\d\.\d/.test(text), text.slice(0, 120));
});

await step('the Conversation view shows only what was said', async () => {
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  const said = page.locator('[aria-label="The conversation"] li');
  check((await said.count()) > 1, 'lines of the conversation');
  await page.getByRole('button', { name: 'What happened', exact: true }).click();
});

await step('a call where something went wrong has it marked', async () => {
  problemCall = await page.evaluate(async () => {
    for (const bot of ['acme-support', 'front-desk', 'bookings']) {
      const list = await (await fetch(`/api/bots/${bot}/calls?limit=100`)).json();
      for (const c of list.calls) {
        const one = await (await fetch(`/api/bots/${bot}/calls/${encodeURIComponent(c.id)}`)).json();
        if (one.events.some((e) => (e.event === 'tool_called' && e.error) || e.event === 'error' || (e.event === 'http_request' && e.status >= 400))) return { bot, id: c.id };
      }
    }
    return null;
  });
  check(problemCall, 'the stand-in has a call with a failed tool');
  await page.goto(`${base}/calls/${encodeURIComponent(problemCall.id)}?agent=${problemCall.bot}`);
  await page.getByRole('region', { name: 'What happened' }).waitFor();
  check((await page.locator('[aria-label="Records"] li[data-problem]').count()) > 0, 'a problem row');
  check((await page.getByLabel('Problem').count()) > 0, 'marked with an icon');
  check(/problem/.test(await page.getByTestId('trace-summary').textContent()), 'counted in the summary');
});

await step('a call’s records are read page by page (after=…)', async () => {
  const asked = [];
  await page.route('**/api/bots/*/calls/*', (route) => {
    const url = new URL(route.request().url());
    if (/\/(transcript|download|stream)$/.test(url.pathname)) return route.continue();
    url.searchParams.set('limit', '3');
    asked.push(url.searchParams.get('after') || '0');
    return route.continue({ url: url.toString() });
  });
  await page.reload();
  await page.getByRole('region', { name: 'What happened' }).waitFor();
  await page.unroute('**/api/bots/*/calls/*');
  const total = (await apiJson(`/bots/${problemCall.bot}/calls/${encodeURIComponent(problemCall.id)}`)).events.length;
  const shown = await page.locator('[aria-label="Records"] li').count();
  check(asked.length > 2 && asked[1] === '3', `pages after: ${asked.join(',')}`);
  check(shown === total, `${shown} of ${total} records`);
});

await step('past the cap: a notice, “Load more records”, and the conversation read on its own (kinds=…)', async () => {
  const kinds = [];
  await page.route('**/api/bots/*/calls/*', async (route) => {
    const url = new URL(route.request().url());
    if (/\/(transcript|download|stream)$/.test(url.pathname)) return route.continue();
    if (url.searchParams.get('kinds')) kinds.push(url.searchParams.get('kinds'));
    const answer = await route.fetch();
    const body = await answer.json();
    // pretend the server holds more than was read
    await route.fulfill({ response: answer, json: { ...body, more: true } });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Load more records' }).waitFor({ timeout: 10_000 });
  check(/Showing the first/.test(await page.locator('main').innerText()), 'it says only the first are shown');
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page.locator('[aria-label="The conversation"]').waitFor({ timeout: 10_000 });
  check(kinds.includes('user_said,agent_said'), kinds.join(' | ') || 'no kinds asked');
  await page.unroute('**/api/bots/*/calls/*');
});

await step('a call going on is followed live over the stream', async () => {
  const live = await page.evaluate(async () => {
    for (const bot of ['front-desk', 'acme-support', 'bookings']) {
      const list = await (await fetch(`/api/bots/${bot}/calls?status=in_progress`)).json();
      if (list.calls.length) return { bot, id: list.calls[0].id };
    }
    return null;
  });
  check(live, 'the stand-in has a call in progress');
  await page.goto(`${base}/calls/${encodeURIComponent(live.id)}?agent=${live.bot}`);
  await page.getByRole('region', { name: 'What happened' }).waitFor();
  await page.getByText('Live now').waitFor();
  await page.getByRole('button', { name: 'Following live' }).waitFor({ timeout: 10_000 });
  const before = await page.locator('[aria-label="Records"] li').count();
  await page.waitForFunction((n) => document.querySelectorAll('[aria-label="Records"] li').length > n, before, { timeout: 60_000 });
  check(true, 'new records arrived');
});

await step('the Test stage’s trace is the same view', async () => {
  await page.goto(`${base}/agents/acme-support/test`);
  await page.getByRole('region', { name: 'Live trace' }).waitFor({ timeout: 15_000 });
  check(/Start a conversation to see/.test(await page.getByRole('region', { name: 'Live trace' }).innerText()), 'its empty state');
});

await finish();
