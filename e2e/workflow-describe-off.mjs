// “Describe it” on a Studio server with no AI model set up (no ANTHROPIC_API_KEY): it says so plainly, offers nothing
// in its place, and the /llm route sends nothing anywhere.
//   E2E_API_PORT=8426 E2E_WEB_PORT=5426 node e2e/workflow-describe-off.mjs
import { check, openBrowser, suite } from './support/harness.mjs';

// Whatever the environment says, this server runs without a key.
process.env.ANTHROPIC_API_KEY = '';
process.env.LLM_BASE_URL = '';

const { page, base, step, finish } = await suite('workflow-describe-off');
const dialog = () => page.getByRole('dialog', { name: 'Describe it' });

await step('/llm/status says no AI model is set up, and a request is refused with 503', async () => {
  await page.goto(`${base}/agents/acme-support/build`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const status = await page.evaluate(async () => (await fetch('/llm/status')).json());
  check(status.configured === false, 'not configured');
  const refused = await page.evaluate(async () => {
    const res = await fetch('/llm/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
    return res.status;
  });
  check(refused === 503, `answered ${refused}`);
  const other = await page.evaluate(async () => (await fetch('/llm/v1/complete', { method: 'POST', body: '{}' })).status);
  check(other === 404, `anything else under /llm is refused (${other})`);
});

await step('Describe it says plainly that no AI model is set up, and offers nothing in its place', async () => {
  await page.getByRole('button', { name: 'Describe it' }).click();
  await dialog().waitFor({ timeout: 5000 });
  await dialog().getByText('No AI model is set up on this Studio server').waitFor({ timeout: 10000 });
  await dialog().getByText(/ANTHROPIC_API_KEY/).waitFor();
  check(await dialog().getByLabel('What should change?').count() === 0, 'no box to type into');
  check(await dialog().getByRole('button', { name: 'Propose a change' }).count() === 0, 'nothing to send');
  await dialog().getByRole('button', { name: 'Close', exact: true }).click();
});

await step('a viewer has no Describe it button', async () => {
  const viewer = await openBrowser({ user: { id: 'e2e-viewer', name: 'Vera Viewer', email: 'vera.viewer@example.com', initials: 'VV', role: 'viewer' } });
  try {
    await viewer.page.goto(`${base}/agents/acme-support/build`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await viewer.page.getByRole('button', { name: 'Preview prompt' }).waitFor({ timeout: 30000 });
    check(await viewer.page.getByRole('button', { name: 'Describe it' }).count() === 0, 'hidden for viewers');
  } finally {
    await viewer.browser.close();
  }
});

await finish();
