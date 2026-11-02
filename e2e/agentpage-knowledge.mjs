/* eslint-env node */
// Build › Knowledge inside an agent (GAPS A22): upload and delete files, build an index and follow it, search it with
// scores, base cards, attach a base, "How it searches"; and the workspace Knowledge page still works with the same parts.
//   E2E_API_PORT=8525 E2E_WEB_PORT=5525 node e2e/agentpage-knowledge.mjs      (E2E_SHOTS=<dir> also saves screenshots)
import path from 'node:path';
import { check, suite } from './support/harness.mjs';

const { page, context, base, step, finish } = await suite('agentpage-knowledge');
const AGENT = '/agents/acme-support/build/knowledge';
const FAQ =
  'Refunds are paid back within five working days to the original card. To get a refund, ask the support team and give your order number.\n\nOur opening hours are nine to five on weekdays. We are closed at weekends.';
const section = () => page.locator('main');
const card = (id) => page.locator(`section[data-base="${id}"]`);
const fileRow = (name) => page.locator(`tr[data-file="${name}"]`);
const upload = (name, text) => page.getByLabel('Choose files to upload').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const saveFromNote = async () => {
  const note = page.locator('[role="note"]', { hasText: 'Knowledge works from the saved draft' });
  await note.getByRole('button', { name: 'Save draft' }).click();
  await note.waitFor({ state: 'detached', timeout: 15_000 });
};
const shot = async (name) => {
  if (process.env.E2E_SHOTS) await page.screenshot({ path: path.join(process.env.E2E_SHOTS, name), fullPage: true });
};

await step('Build › Knowledge opens with every base and the files on the server', async () => {
  await page.goto(`${base}${AGENT}`, { timeout: 120_000 });
  await page.getByRole('heading', { name: 'Every knowledge base' }).waitFor();
  await section().getByText('No knowledge bases yet').waitFor();
  await page.getByRole('heading', { name: 'Files on the server' }).waitFor();
  check(await section().getByText('No files uploaded yet.').isVisible(), 'the empty file list says so');
});

await step('uploading a file puts it on the server and in the draft as what it knows', async () => {
  await upload('faq.md', FAQ);
  await fileRow('faq.md').waitFor();
  await section().getByText('Added faq.md to what it knows').waitFor();
  await card('knowledge').waitFor();
  check(await card('knowledge').getByText('Not saved yet').isVisible(), 'a base only in the editor says it is not saved');
  check(await page.getByText('Knowledge works from the saved draft').isVisible(), 'the unsaved draft is said');
});

await step('saving shows the base card as the server has it: not built, read by the agent, its source uploaded', async () => {
  await saveFromNote();
  await card('knowledge').getByText('Not built').waitFor({ timeout: 15_000 });
  check(await card('knowledge').getByText('Read by Acme Support in every conversation.').isVisible(), 'who reads it is said');
  check(await card('knowledge').getByText('faq.md').first().isVisible(), 'its source is listed');
  check(await card('knowledge').getByText('Uploaded', { exact: true }).isVisible(), 'the source is on the server');
});

await step('building the index is followed until it is ready', async () => {
  await card('knowledge').getByRole('button', { name: 'Build the index' }).click();
  await card('knowledge').getByText('Building the index…').waitFor({ timeout: 10_000 });
  await card('knowledge').getByText(/Build finished: \d+ passages?\./).waitFor({ timeout: 20_000 });
  await card('knowledge').getByText('Ready', { exact: true }).waitFor({ timeout: 10_000 });
  check(await card('knowledge').getByText(/Index built .*passage/).isVisible(), 'the index line says how many passages');
});

await step('a search shows the passages found with their scores', async () => {
  await card('knowledge').getByRole('button', { name: 'Try a search' }).click();
  await card('knowledge').getByLabel('Search text').fill('how do I get a refund');
  await card('knowledge').getByRole('button', { name: 'Search', exact: true }).click();
  const hit = card('knowledge').locator('li[data-score]').first();
  await hit.waitFor({ timeout: 10_000 });
  check(/Score \d\.\d\d/.test(await hit.innerText()), 'a score is shown');
  check(/Refunds/.test(await hit.innerText()), 'the passage text is shown');
  check(await card('knowledge').getByText(/no minimum score is set/).isVisible(), 'what min_score would drop is said');
});

await step('“How it searches” says when and how the base is searched', async () => {
  await card('knowledge').getByText('How it searches').click();
  await card('knowledge').getByText(/searched before every reply/).waitFor();
  check(await card('knowledge').getByText(/usual number of passages \(4\)/).isVisible(), 'the passage count is said');
  await shot('knowledge-section-light.png');
});

await step('a file nothing reads is deleted at once', async () => {
  // a third base first, so a new upload waits for “Use in…” and nothing reads it
  await upload('prices.md', 'Delivery costs five pounds. Express delivery costs ten pounds.');
  await fileRow('prices.md').waitFor();
  await page.getByLabel('Use prices.md in a base').selectOption('__new');
  await card('prices').waitFor();
  await upload('notes.txt', 'Internal notes nobody reads.');
  await section().getByText(/notes\.txt is on the server\. Choose a base/).waitFor();
  await fileRow('notes.txt').getByRole('button', { name: 'Delete notes.txt' }).click();
  await fileRow('notes.txt').waitFor({ state: 'detached', timeout: 10_000 });
});

await step('a base nothing reads offers to let the agent use it, and then names the tool that looks it up', async () => {
  check(await card('prices').getByText('Nothing reads it yet, so no agent answers from it.').isVisible(), 'an unread base says so');
  await card('prices').getByRole('button', { name: 'Let Acme Support use it' }).click();
  await card('prices').getByText('Looked up with the “Search prices” tool (Acme Support).').waitFor();
  await saveFromNote();
  await card('prices').getByText('Not built').waitFor({ timeout: 15_000 });
});

await step('deleting a file a base reads asks first, and “Delete anyway” deletes it', async () => {
  await fileRow('faq.md').getByRole('button', { name: 'Delete faq.md' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Delete faq.md anyway?').waitFor();
  check(/read by the knowledge base 'knowledge'/.test(await dialog.innerText()), 'the server’s reason is shown');
  await dialog.getByRole('button', { name: 'Delete anyway' }).click();
  await fileRow('faq.md').waitFor({ state: 'detached', timeout: 10_000 });
  await card('knowledge').getByText('Not uploaded', { exact: true }).waitFor({ timeout: 10_000 });
});

await step('dark theme screenshot of the section', async () => {
  // the harness sets the theme before every load; an init script added later runs after it, so it wins
  await context.addInitScript(() => localStorage.setItem('weave_theme', 'dark'));
  await page.reload();
  check(await page.evaluate(() => document.documentElement.classList.contains('dark')), 'the dark theme is on');
  await card('knowledge').waitFor({ timeout: 15_000 });
  await shot('knowledge-section-dark.png');
  await context.addInitScript(() => localStorage.setItem('weave_theme', 'light'));
});

await step('the workspace Knowledge page still opens, lists the bases and searches them', async () => {
  await page.goto(`${base}/knowledge?agent=acme-support`);
  await page.getByRole('heading', { name: 'Knowledge', exact: true }).waitFor();
  await page.getByText(/Knowledge Bases \(2\)/).waitFor({ timeout: 15_000 });
  await page.getByLabel('Search text').fill('refund');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('li[data-score]').first().waitFor({ timeout: 10_000 });
  await page.getByText(/Knowledge Bases \(2\)/).click();
  await page.getByText('Needs rebuilding', { exact: true }).first().waitFor();
  await shot('knowledge-page-light.png');
});

await finish();
