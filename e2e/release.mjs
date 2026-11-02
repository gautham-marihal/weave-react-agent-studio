// Release: environments from the server, phone numbers per environment, the Tests chip per version, the release
// checklist, publishing under the draft's own number and putting it live in Development in one click.
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish, errors } = await suite('release');

// The stand-in API, through Studio's own proxy, for setting things up the way another person or a script would.
async function call(method, path, body) {
  const res = await fetch(`${base}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const open = async (path, text) => {
  await page.goto(`${base}${path}`, { timeout: 90_000 });
  await page.locator('main').waitFor();
  if (text) await page.getByText(text, { exact: false }).first().waitFor({ timeout: 15_000 });
};
const dialog = () => page.getByRole('dialog');

await step('the environments come from the server', async () => {
  const envs = await call('GET', '/environments');
  await open('/agents/acme-support/release', 'Environments');
  await page.locator('[data-env]').first().waitFor();
  const shown = await page.locator('[data-env]').evaluateAll((els) => els.map((e) => e.getAttribute('data-env')));
  check(JSON.stringify(shown) === JSON.stringify(envs), `cards ${shown} vs server ${envs}`);
  check(!(await page.getByText('Reading the server’s environments').count()), 'it still says it is reading the environments');
});

await step('each environment names the phone numbers it answers', async () => {
  await call('POST', '/bots/acme-support/numbers', { number: '+6590005', environment: 'staging' });
  await open('/agents/acme-support/release', 'Phone numbers');
  await page.locator('[data-numbers="staging"]').waitFor({ timeout: 10_000 });
  check(/\+6590005/.test(await page.locator('[data-numbers="staging"]').innerText()), 'the staging card does not show its number');
  check((await page.locator('[data-number="+6590005"]').count()) === 1, 'the number is not in the list');
  check(!(await page.locator('[data-numbers="production"]').count()), 'production shows a number it does not answer');
});

await step('"Add a number" adds one for an environment', async () => {
  await page.getByRole('button', { name: 'Add a number' }).click();
  await dialog().getByText('The number people dial').waitFor();
  await dialog().locator('input[type="tel"]').fill('+6590006');
  await dialog().getByText('Free to use.').waitFor({ timeout: 10_000 });
  await dialog().locator('select').selectOption('development');
  await dialog().getByRole('button', { name: 'Add number' }).click();
  await page.locator('[data-number="+6590006"]').waitFor({ timeout: 10_000 });
  check(/\+6590006/.test(await page.locator('[data-numbers="development"]').innerText()), 'the development card does not show the new number');
});

await step('each version says whether its tests ran on that exact version', async () => {
  // A test in the draft, published as 0.1.2, and run on that version.
  const draft = await call('GET', '/bots/acme-support/draft');
  const channel = draft.config.channels[0].id;
  const tests = [{ id: 'says_hello', channel, turns: [{ say: 'Hello' }], expect: [{ said_matches: '.+' }] }];
  await call('PUT', '/bots/acme-support/draft', { config: { ...draft.config, tests } });
  const published = await call('POST', '/bots/acme-support/publish', { bump: 'patch' });
  const run = await call('POST', '/bots/acme-support/tests/run', { ref: published.version, live: true });
  const runId = run.run_id || run.id;
  for (let i = 0; i < 40; i += 1) {
    const now = await call('GET', `/bots/acme-support/tests/runs/${runId}`);
    if (now.status !== 'running') break;
    await page.waitForTimeout(250);
  }
  await open('/agents/acme-support/release', 'Versions');
  const row = page.locator(`[data-version="${published.version}"]`);
  await row.getByText(/Tests: (Passed|Failed|Broke)/).waitFor({ timeout: 15_000 });
  check(/Tests: Not run/.test(await page.locator('[data-version="0.1.1"]').innerText()), 'an untested version does not say "Not run"');
});

await step('the deploy dialog asks "Is it safe to put this live?" for the chosen version', async () => {
  await page.locator('[data-version="0.1.2"]').getByRole('button', { name: 'Deploy', exact: true }).click();
  await dialog().getByText('Is it safe to put this live?').waitFor({ timeout: 15_000 });
  await dialog().locator('[data-check="tests"]').getByText(/on this exact version/).waitFor({ timeout: 15_000 });
  check((await dialog().locator('[data-check="valid"]').count()) === 1, 'no "Valid" line');
  check(/advice/.test(await dialog().getByLabel('Release checklist').innerText()), 'the list does not say it is advice');
});

await step('production stays behind the typed confirmation', async () => {
  await dialog().getByRole('radio', { name: /Production/ }).click();
  const go = dialog().getByRole('button', { name: /Deploy 0\.1\.2 to Production/ });
  check(await go.isDisabled(), 'production deploys without the typed confirmation');
  await dialog().locator('#prod-confirm').fill('acme-support');
  check(!(await go.isDisabled()), 'the typed confirmation does not unlock it');
  await dialog().getByRole('radio', { name: /Staging/ }).click();
});

await step('deploying to an environment puts the version there', async () => {
  await dialog().getByRole('button', { name: 'Deploy 0.1.2 to Staging' }).click();
  await dialog().getByText('0.1.2 is live in Staging.').waitFor({ timeout: 20_000 });
  await dialog().getByRole('button', { name: 'Done' }).click();
  await page.locator('[data-env="staging"]').getByText('0.1.2').waitFor();
});

await step('a draft with a newer number of its own is offered first in Publish', async () => {
  const draft = await call('GET', '/bots/acme-support/draft');
  await call('PUT', '/bots/acme-support/draft', { config: { ...draft.config, meta: { ...draft.config.meta, version: '0.4.0' } } });
  await open('/agents/acme-support/release', 'Versions');
  await page.getByRole('main').getByRole('button', { name: 'Publish', exact: true }).first().click();
  await dialog().getByRole('radiogroup', { name: 'Version number' }).waitFor();
  const first = dialog().getByRole('radio').first();
  check(/The draft’s version/.test(await first.innerText()) && (await first.getAttribute('aria-checked')) === 'true', 'the draft’s own number is not offered first and chosen');
  check(/Publish version 0\.4\.0/.test(await dialog().locator('h2').first().innerText()), 'the title does not name 0.4.0');
  await dialog().getByText('Is it safe to put this live?').waitFor();
  await dialog().getByRole('button', { name: 'Cancel' }).click();
});

await step('the first version is published under the draft’s number, then put live in Development in one click', async () => {
  const draft = await call('GET', '/bots/bookings/draft');
  const number = draft.config.meta.version;
  await open('/agents/bookings/release', 'Versions');
  await page.getByRole('main').getByRole('button', { name: 'Publish', exact: true }).first().click();
  await dialog().getByText('This is the first version of this agent').waitFor();
  await dialog().getByRole('button', { name: `Publish ${number}` }).click();
  await dialog().getByText(`Version ${number} is published`).waitFor({ timeout: 15_000 });
  await dialog().getByRole('button', { name: 'Put it live in Development' }).click();
  await dialog().getByText(`Version ${number} is live in Development`).waitFor({ timeout: 20_000 });
  await dialog().getByRole('button', { name: 'See where it runs' }).click();
  await page.locator('[data-env="development"]').getByText(number).waitFor({ timeout: 10_000 });
});

// Studio's toasts warn in development (ToastItem is not a forwardRef inside AnimatePresence): known, not this suite's.
const known = /ToastItem/;
errors.splice(0, errors.length, ...errors.filter((e) => !known.test(e)));
await finish();
