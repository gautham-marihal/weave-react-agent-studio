// How the parts of an agent relate: the agent map (Build › Agent), who can use which tool (Build › Tools), and “used
// by” buttons (a tool and a remembered value on the Workflow).
//   E2E_API_PORT=8426 E2E_WEB_PORT=5426 node e2e/workflow-relations.mjs
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish, errors } = await suite('workflow-relations');
const node = (id) => page.locator(`.react-flow__node[data-id="${id}"]`);
const map = () => page.locator('[data-agent-map]');
const save = async () => {
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Save' && !b.disabled), null, { timeout: 15000 });
};

await step('one agent alone draws no map', async () => {
  await page.goto(`${base}/agents/acme-support/build/agent`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.getByRole('heading', { name: 'Agent', exact: true }).first().waitFor({ timeout: 60000 });
  check(await map().count() === 0, 'no map for a single agent');
});

await step('with specialists, the map shows every agent, marks the one that answers first, and says it in sentences', async () => {
  await page.goto(`${base}/agents/acme-support/build?view=canvas`, { waitUntil: 'domcontentloaded' });
  await node('assistant').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /Templates/ }).click();
  await page.getByRole('menuitem', { name: /Front desk with specialists/ }).click();
  await node('sales').waitFor({ timeout: 5000 });
  await save();
  await page.goto(`${base}/agents/acme-support/build/agent`, { waitUntil: 'domcontentloaded' });
  await map().waitFor({ timeout: 30000 });
  check(await map().locator('[data-map-node]').count() === 3, 'three boxes');
  check(/answers first/.test(await map().locator('[data-map-node="assistant"]').getAttribute('aria-label')), 'the first agent is marked');
  check(await map().locator('[data-map-edge="handoff"]').count() === 2, 'two hand-offs are arrows');
  await map().getByText('As a list').click();
  await map().getByText('Acme Support hands the caller to Sales (The caller wants to buy something, or asks about prices or plans.).').waitFor({ timeout: 3000 });
});

await step('pressing an agent’s box opens that agent’s settings', async () => {
  await map().locator('[data-map-node="sales"]').click();
  // its settings open where they are: in the settings form on this page, or else in All settings
  const focused = () => /^agents\.items\[(\d+)\]/.exec(document.activeElement?.closest('[data-path]')?.getAttribute('data-path') || '')?.[1] ?? null;
  await page.waitForFunction((src) => new URLSearchParams(location.search).get('view') === 'all' || new Function(`return (${src})()`)() !== null, focused.toString(), { timeout: 5000 });
  const index = await page.evaluate(focused);
  if (index !== null) {
    const draft = await page.evaluate(async () => (await fetch('/api/bots/acme-support/draft')).json());
    const id = draft.config.agents.items[Number(index)]?.id;
    check(id === 'sales', `the settings of ${id} opened, not Sales’s`);
  }
});

await step('an agent nothing hands off to is drawn apart and called out', async () => {
  await page.goto(`${base}/agents/acme-support/build?view=canvas`, { waitUntil: 'domcontentloaded' });
  await node('assistant').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Advanced: every agent, the values a call remembers, events' }).click();
  const dialog = page.getByRole('dialog', { name: 'Advanced' });
  await dialog.getByLabel('Name of support').fill('Support desk');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  // take the hand-off to Support away, so nothing reaches it
  await node('assistant').click();
  await page.getByRole('button', { name: 'Remove the hand-off to Support desk' }).click();
  await save();
  await page.goto(`${base}/agents/acme-support/build/agent`, { waitUntil: 'domcontentloaded' });
  await map().waitFor({ timeout: 30000 });
  await map().getByText('“Support desk” can’t be reached').waitFor({ timeout: 3000 });
  check(/cannot be reached/.test(await map().locator('[data-map-node="support"]').getAttribute('aria-label')), 'the box says so');
});

await step('the tool grid says which tools nobody has, and a tick gives a tool to an agent', async () => {
  await page.goto(`${base}/agents/acme-support/build/tools`, { waitUntil: 'domcontentloaded' });
  const grid = page.locator('[data-tool-grid]');
  await grid.waitFor({ timeout: 30000 });
  await grid.locator('summary').click();
  const box = grid.getByLabel('Sales can use Escalate to human');
  check(!(await box.isChecked()), 'Sales has no way to a person yet');
  await box.check();
  await page.getByText('Gave “Escalate to human” to Sales.').first().waitFor({ timeout: 3000 });
  check(await box.isChecked(), 'ticked');
});

await step('Undo on the toast takes the tick back', async () => {
  await page.getByRole('button', { name: 'Undo', exact: true }).last().click();
  const box = page.locator('[data-tool-grid]').getByLabel('Sales can use Escalate to human');
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll('[data-tool-grid] input')].find((i) => i.getAttribute('aria-label') === 'Sales can use Escalate to human');
    return el && !el.checked;
  }, null, { timeout: 3000 });
  check(!(await box.isChecked()), 'unticked again');
});

await step('a tool says where it is named, as buttons that go there', async () => {
  await page.goto(`${base}/agents/acme-support/build?view=canvas`, { waitUntil: 'domcontentloaded' });
  await node('tool::escalate_to_human').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Fit to screen (Shift+1)' }).click();
  await page.waitForTimeout(400);
  await node('tool::escalate_to_human').click();
  const used = page.locator('[data-used-by]').first();
  await used.getByRole('button', { name: 'agent “Acme Support”' }).click();
  await page.waitForFunction(() => document.querySelector('.react-flow__node[data-id="assistant"]')?.classList.contains('selected'), null, { timeout: 5000 });
});

// Known warnings of the studio's toasts (ToastItem), not of these screens.
for (let i = errors.length - 1; i >= 0; i -= 1) if (errors[i].includes('ToastItem')) errors.splice(i, 1);

await finish();
