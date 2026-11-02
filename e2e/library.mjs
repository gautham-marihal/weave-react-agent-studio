// The Library in a real browser against the stand-in API: voices (used by, favourites, only recorded samples played,
// "Use in an agent" landing in the agent's draft unsaved with a notice, custom voice ids), integrations ("Add to an
// agent" as a draft connection naming a server secret, nothing kept in the browser), and phone numbers (check as typed,
// set up, change with PATCH, noise filtering, allowed addresses, longest call, setup warnings, last call, release, and
// the "not available" state of a server with no phone system).
//   E2E_API_PORT=8529 E2E_WEB_PORT=5529 node e2e/library.mjs
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish, errors } = await suite('library');
page.setDefaultTimeout(20_000);
page.setDefaultNavigationTimeout(90_000);
// Studio's toasts warn in development (ToastItem is not a forwardRef inside AnimatePresence, and it dismisses itself
// while rendering): known, in a shared component, not this suite's.
const KNOWN = /ToastItem/;

const api = (path) => page.evaluate(async (p) => (await fetch(`/api${p}`)).json(), path);
const dialog = (name) => page.getByRole('dialog', { name });
const card = (id) => page.locator(`[data-voice="${id}"]`);
const openLibrary = async (tab = '') => {
  await page.goto(`${base}/library${tab ? `?tab=${tab}` : ''}`);
  await page.getByRole('heading', { name: 'Library', level: 1 }).waitFor();
};

// the samples are somebody else's server: answer with a tiny silent sound, and note which address was asked for
const samples = [];
await page.route(
  (url) => /storage\.googleapis\.com|elevenlabs\.io|\.mp3$/.test(url.href) && !url.href.includes('localhost'),
  (route) => {
    samples.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.from('UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=', 'base64') });
  },
);

// ---- voices (W30) -----------------------------------------------------------------------------------------------------
await step('each voice says which agents use it, read from their drafts', async () => {
  await openLibrary();
  await card('elevenlabs-sarah').getByText('Front Desk').waitFor({ timeout: 30_000 });
  check(/Used by\s*Front Desk/.test(await card('elevenlabs-sarah').getByTestId('used-by').innerText()), 'Sarah is used by Front Desk');
  check(/Not in use/.test(await card('elevenlabs-adam').getByTestId('used-by').innerText()), 'Adam is not in use');
});

await step('a voice plays its own recorded sample, and two voices are two recordings', async () => {
  await card('elevenlabs-sarah').getByRole('button', { name: 'Listen to Sarah' }).click();
  await page.waitForTimeout(400);
  await card('elevenlabs-adam').getByRole('button', { name: 'Listen to Adam' }).click();
  await page.waitForTimeout(400);
  check(samples.some((u) => u.includes('EXAVITQu4vr4xnSDxMaL')) && samples.some((u) => u.includes('pNInz6obpgDQGcFmaJgB')), samples.join(' | '));
  check(!/approximation|browser’s voice/i.test(await page.locator('main').innerText()), 'no browser-voice stand-in is offered');
  await card('elevenlabs-adam').getByRole('button', { name: /Stop Adam|Listen to Adam/ }).click();
});

await step('favourites are starred, filtered, and kept in this browser', async () => {
  await card('elevenlabs-sarah').getByRole('button', { name: 'Add Sarah to favourites' }).click();
  await page.getByRole('button', { name: /Favourites \(1\)/ }).click();
  check((await page.locator('[data-voice]').count()) === 1, 'only the favourite is shown');
  await page.reload();
  await page.getByRole('button', { name: /Favourites \(1\)/ }).waitFor();
  check(/Favourites are kept in this browser/.test(await page.locator('main').innerText()), 'says where favourites are kept');
});

await step('“Use in an agent” puts the voice on that agent’s draft, unsaved, with a notice, and Save keeps it', async () => {
  await openLibrary();
  await card('elevenlabs-adam').getByRole('button', { name: 'Use in an agent' }).click();
  const picker = dialog('Use Adam in an agent');
  await picker.getByRole('button', { name: /Bookings/ }).click();
  await page.waitForURL(/\/agents\/bookings\/build\/agent\?focus=voice/);
  await page.getByText('The voice “Adam” (ElevenLabs) is set on this draft.').waitFor({ timeout: 30_000 });
  check(/Not saved yet/.test(await page.locator('body').innerText()), 'says it is not saved yet');
  check(await page.getByRole('button', { name: /^Save$/ }).isEnabled(), 'the draft has an unsaved edit');
  check(!(await api('/bots/bookings/draft')).config.defaults?.models?.tts?.voice_id, 'nothing is saved yet');
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForFunction(async () => (await (await fetch('/api/bots/bookings/draft')).json()).config.defaults?.models?.tts?.voice_id === 'pNInz6obpgDQGcFmaJgB');
  const tts = (await api('/bots/bookings/draft')).config.defaults.models.tts;
  check(tts.provider === 'elevenlabs' && !!tts.model, `saved: ${JSON.stringify(tts)}`);
  await openLibrary();
  await card('elevenlabs-adam').getByText('Bookings').waitFor();
});

await step('a custom voice id is used the same way, and Undo on the notice takes it back', async () => {
  await page.getByRole('group', { name: 'Voice library sections' }).getByRole('button', { name: 'Custom voices' }).click();
  check(/no endpoint for it/.test(await page.locator('main').innerText()), 'says cloning and uploads are not available');
  await page.getByLabel('Provider', { exact: true }).selectOption('elevenlabs');
  await page.getByLabel('Voice id').fill('our-own-voice-1');
  await page.getByLabel('A name for it (optional)').fill('Brand voice');
  await page.getByRole('button', { name: 'Use in an agent' }).click();
  await dialog('Use Brand voice in an agent').getByRole('button', { name: /Bookings/ }).click();
  await page.getByText('The voice “Brand voice” (ElevenLabs) is set on this draft.').waitFor({ timeout: 30_000 });
  check(await page.getByRole('button', { name: /^Save$/ }).isEnabled(), 'the draft has an unsaved edit');
  await page.getByTitle('Undo (Ctrl+Z)').click();
  check(!(await page.getByRole('button', { name: /^Save$/ }).isEnabled()), 'nothing is left to save');
});

// ---- integrations (W31) -----------------------------------------------------------------------------------------------
await step('“Add to an agent” adds a connection naming a server secret to the draft, and keeps nothing in the browser', async () => {
  await openLibrary('integrations');
  await page.locator('[data-integration="crm"]').getByRole('button', { name: 'Add to an agent' }).click();
  const box = dialog(/Add CRM Context/);
  check(await box.getByRole('button', { name: /Acme Support/ }).isDisabled(), 'no agent can be chosen before the address is given');
  check(/First: give the system’s address/.test(await box.innerText()), 'and it says what is missing');
  await box.getByLabel('Address of the system').fill('https://crm.example.test/api');
  check((await box.getByLabel('Server secret name').inputValue()) === 'CRM_API_TOKEN', 'the catalogue’s secret name is offered');
  await box.getByRole('button', { name: /Acme Support/ }).click();
  await page.waitForURL(/\/agents\/acme-support\/build\/tools/);
  await page.getByText('A connection to https://crm.example.test/api is added to this draft. It signs in with the server secret CRM_API_TOKEN. Tools can now use it.').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForFunction(async () => !!(await (await fetch('/api/bots/acme-support/draft')).json()).config.connections?.crm);
  const connection = (await api('/bots/acme-support/draft')).config.connections.crm;
  check(JSON.stringify(connection) === JSON.stringify({ type: 'http', base_url: 'https://crm.example.test/api', timeout_s: 10, auth: { type: 'bearer', token: { secret: 'CRM_API_TOKEN' } } }), JSON.stringify(connection));
  const kept = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  check(!kept.includes('crm.example.test'), 'no address (or key) is left in browser storage');
});

// ---- phone numbers (W32) ----------------------------------------------------------------------------------------------
const row = (number) => page.locator(`[data-number="${number}"]`);

await step('numbers set up outside Studio are listed, read-only', async () => {
  await openLibrary('numbers');
  await row('+6563001000').waitFor({ timeout: 30_000 });
  check(/Set up outside Studio/.test(await row('+6563001000').innerText()), 'says so');
  check((await row('+6563001000').getByRole('button').count()) === 0, 'no change or release');
});

await step('a number is checked as typed, and the setup warns when nothing deployed would answer it', async () => {
  await page.getByRole('button', { name: 'Add a number' }).click();
  const box = dialog('Add a phone number');
  await box.getByLabel('Number', { exact: true }).fill('+6563001000');
  await box.locator('[data-check="taken_external"]').waitFor();
  check(/used by “singtel poc”, which Studio does not manage/.test(await box.locator('#number-check').innerText()), 'taken outside Studio');
  await box.getByRole('button', { name: 'Set up this number…' }).click();
  check(/used by “singtel poc”/.test(await box.getByRole('alert').innerText()), 'and refused with the reason');
  await box.getByLabel('Number', { exact: true }).fill('+6599990000');
  await box.locator('[data-check="free"]').waitFor();
  await box.getByLabel('Agent', { exact: true }).selectOption('bookings');
  await page.waitForTimeout(300);
  const options = await box.getByLabel('Environment that answers it').locator('option').allInnerTexts();
  check(options.every((o) => /· (runs v|nothing deployed)/.test(o)), options.join(' | '));
  await box.getByLabel('Environment that answers it').selectOption('production');
  await box.locator('[data-note="setup-warning"]').waitFor();
  check(/Nothing is deployed to Production for Bookings/.test(await box.locator('[data-note="setup-warning"]').innerText()), 'warns');
  await box.getByRole('button', { name: 'Set up this number…' }).click();
  const review = box.getByTestId('number-review');
  check(/Set up \+6599990000 for Bookings, in Production/.test(await review.innerText()), await review.innerText());
  await box.getByRole('button', { name: 'Set up the number' }).click();
  await row('+6599990000').waitFor();
  check(/Needs attention/.test(await row('+6599990000').innerText()), await row('+6599990000').innerText());
  check(/was set up for Bookings in Production/.test(await page.locator('main').innerText()), 'says it was set up');
});

await step('a number is changed with PATCH: noise filtering, allowed addresses, longest call, said first', async () => {
  const sent = [];
  page.on('request', (r) => r.method() === 'PATCH' && sent.push(r.postData()));
  await row('+6599990000').getByRole('button', { name: 'Change +6599990000' }).click();
  const box = dialog('Change +6599990000');
  await box.getByLabel('Filter background noise').check();
  await box.getByLabel('Longest call (minutes)').fill('30');
  await box.getByLabel('Only accept calls from these addresses').fill('10.0.0.0/8');
  await box.getByRole('button', { name: 'Review changes…' }).click();
  const review = await box.getByTestId('number-review').innerText();
  check(/Start filtering background noise\./.test(review) && /Only accept calls from 10\.0\.0\.0\/8\./.test(review) && /End calls after 30 minutes\./.test(review), review);
  await box.getByRole('button', { name: 'Save changes' }).click();
  await box.waitFor({ state: 'detached' });
  check(sent.length === 1 && JSON.stringify(JSON.parse(sent[0])) === JSON.stringify({ krisp: true, allowed_addresses: ['10.0.0.0/8'], max_call_duration_s: 1800 }), `only what changed was sent: ${sent}`);
  const text = await row('+6599990000').innerText();
  check(/noise filtering on/.test(text) && /calls end after 30 minutes/.test(text) && /only from 1 address/.test(text), text);
});

await step('a number where a version with a phone line is deployed waits for calls, and says the last call', async () => {
  await page.getByRole('button', { name: 'Add a number' }).click();
  const box = dialog('Add a phone number');
  await box.getByLabel('Number', { exact: true }).fill('+6599990001');
  await box.locator('[data-check="free"]').waitFor();
  await box.getByLabel('Agent', { exact: true }).selectOption('front-desk');
  await box.getByLabel('Environment that answers it').selectOption('development');
  await page.waitForTimeout(400);
  check((await box.locator('[data-note="setup-warning"]').count()) === 0, 'no warning: version 0.1.0 has a phone line');
  await box.getByRole('button', { name: 'Set up this number…' }).click();
  await box.getByRole('button', { name: 'Set up the number' }).click();
  await row('+6599990001').waitFor();
  const text = await row('+6599990001').innerText();
  check(/Waiting for calls/.test(text) && /Answered by version 0\.1\.0 of Front Desk, in Development/.test(text), text);
  // the stand-in never logs a call to a number, so the last call is added to its answer here
  await page.route('**/api/numbers', async (route) => {
    const answer = await route.fetch();
    const rows = await answer.json();
    const at = new Date(Date.now() - 5 * 60000).toISOString();
    const list = (Array.isArray(rows) ? rows : rows.numbers).map((r) => (r.number === '+6599990001' ? { ...r, status: 'ready', last_call: { id: 'c1', at, caller: '+6591234567', status: 'unfinished' } } : r));
    await route.fulfill({ response: answer, json: list });
  });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await row('+6599990001').locator('[data-note="last-call"]').waitFor();
  check(/Last call 5 min ago, from \+6591234567 \(cut off\)/.test(await row('+6599990001').locator('[data-note="last-call"]').innerText()), 'last call in words');
  await page.unroute('**/api/numbers');
});

await step('moving a number to an environment with nothing deployed warns before anything is sent', async () => {
  await row('+6599990001').getByRole('button', { name: 'Change +6599990001' }).click();
  const box = dialog('Change +6599990001');
  await box.getByLabel('Environment that answers it').selectOption('staging');
  await box.locator('[data-note="setup-warning"]').waitFor();
  check(/Nothing is deployed to Staging for Front Desk/.test(await box.locator('[data-note="setup-warning"]').innerText()), 'warns');
  await box.getByRole('button', { name: 'Cancel' }).click();
});

await step('a number is released after asking', async () => {
  await row('+6599990000').getByRole('button', { name: 'Release +6599990000' }).click();
  const ask = dialog('Release +6599990000?');
  check(/can’t be undone/.test(await ask.innerText()), 'says it can’t be undone');
  await ask.getByRole('button', { name: 'Release the number' }).click();
  await row('+6599990000').waitFor({ state: 'detached' });
  check(/was released/.test(await page.locator('main').innerText()), 'says it was released');
});

await step('a server with no phone system (503) says numbers are not available, not “no numbers”', async () => {
  await page.route('**/api/numbers/settings', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"LIVEKIT_URL is not set"}' }));
  await openLibrary('numbers');
  await page.getByTestId('numbers-unavailable').waitFor();
  const text = await page.getByTestId('numbers-unavailable').innerText();
  check(/Phone numbers are not available on this server/.test(text) && /no phone-system \(LiveKit\) credentials/.test(text), text);
  check((await page.getByRole('button', { name: 'Add a number' }).count()) === 0, 'nothing to add');
  await page.unroute('**/api/numbers/settings');
});

errors.splice(0, errors.length, ...errors.filter((e) => !KNOWN.test(e)));
await finish();
