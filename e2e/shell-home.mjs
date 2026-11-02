// Home (greeting and counts, the "Next step" agent chooser and the agent last opened, the library shortcuts, the test
// conversations counted from real calls) and the Team page (kept in this browser: invite, role and scope, change,
// remove, filter).
//   E2E_API_PORT=8430 E2E_WEB_PORT=5430 node e2e/shell-home.mjs
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish } = await suite('shell-home');

const urlIs = (re) => page.waitForFunction((src) => new RegExp(src).test(location.pathname + location.search), re.source, { timeout: 15_000 });
const ready = async (path, text) => {
  await page.goto(`${base}${path}`);
  await page.locator('main').waitFor();
  if (text) await page.getByText(text).first().waitFor({ timeout: 15_000 });
};
const nextStepAgent = () => page.locator('section[aria-labelledby="next-step"] a[href^="/agents/"]').first().innerText();

// the dev server prepares its files on the first visit: give it time once
await page.goto(`${base}/`, { timeout: 120_000 }).catch(() => {});
await page.locator('main').waitFor({ timeout: 120_000 }).catch(() => {});

await step('Home greets the person by first name and counts the agents and the published ones', async () => {
  await ready('/');
  const h1 = page.getByRole('heading', { level: 1 });
  await h1.waitFor();
  check(/^Good (morning|afternoon|evening), Test$/.test((await h1.innerText()).trim()), `heading: ${await h1.innerText()}`);
  await page.getByTestId('home-counts').filter({ hasText: /published/ }).waitFor();
  const line = await page.getByTestId('home-counts').innerText();
  check(line.trim() === '3 agents, 2 published.', `the line says “${line}”`);
});

await step('“Next step” can be about any agent, and Home remembers the choice', async () => {
  await ready('/');
  const chooser = page.getByRole('combobox', { name: 'Which agent' });
  await chooser.waitFor();
  await chooser.selectOption('front-desk');
  await page.waitForFunction(() => /Front Desk/.test(document.querySelector('section[aria-labelledby="next-step"]')?.textContent || ''));
  await page.reload();
  await page.getByRole('combobox', { name: 'Which agent' }).waitFor();
  check((await nextStepAgent()) === 'Front Desk', `after a reload it is ${await nextStepAgent()}`);
});

await step('“Next step” starts from the agent opened last', async () => {
  await ready('/agents/bookings', 'Bookings');
  await page.locator('#studio-sidebar').getByRole('link', { name: 'Home' }).click();
  await urlIs(/^\/$/);
  await page.getByRole('combobox', { name: 'Which agent' }).waitFor();
  check((await nextStepAgent()) === 'Bookings', `it is ${await nextStepAgent()}`);
  check((await page.getByRole('combobox', { name: 'Which agent' }).inputValue()) === 'bookings', 'the chooser says the same');
});

await step('the workspace tools open their own tab of the Library; What’s live and the audit log are still there', async () => {
  await ready('/');
  check(await page.getByRole('heading', { name: 'What’s live' }).isVisible(), 'What’s live is on Home');
  check(await page.getByRole('button', { name: 'Audit log' }).isVisible(), 'the audit log is on Home');
  for (const [title, tab] of [
    ['Phone numbers', 'Phone numbers'],
    ['Integrations', 'Integrations'],
    ['Explore voices', 'Voices'],
  ]) {
    await ready('/');
    await page.getByRole('link', { name: new RegExp(title) }).click();
    await urlIs(/^\/library\?tab=/);
    const pressed = page.getByRole('group', { name: 'Library section' }).getByRole('button', { name: new RegExp(tab) });
    await pressed.waitFor();
    check((await pressed.getAttribute('aria-pressed')) === 'true', `${tab} is the open tab`);
  }
});

await step('test conversations are counted from the drafts’ real calls, over 7 or 30 days', async () => {
  await ready('/');
  // what the server says: every agent's calls of the last 30 days whose ref is the draft
  const expected = await page.evaluate(async () => {
    const bots = await (await fetch('/api/bots')).json();
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const all = [];
    for (const b of bots) {
      const res = await (await fetch(`/api/bots/${b.id}/calls?limit=200&since=${encodeURIComponent(since)}`)).json();
      all.push(...res.calls.filter((c) => !c.ref || c.ref === 'draft'));
    }
    const within = (d) => all.filter((c) => Date.parse(c.started_at) >= Date.now() - d * 864e5);
    return { week: within(7).length, month: within(30).length, weekMessages: within(7).reduce((s, c) => s + (c.caller_turns || 0), 0) };
  });
  check(expected.week > 0, 'the stand-in has test conversations this week');
  const section = page.locator('section[aria-labelledby="test-conversations"]');
  await section.locator('[data-stat="Conversations"]').waitFor({ timeout: 20_000 });
  const shown = async (name) => Number((await section.locator(`[data-stat="${name}"]`).innerText()).trim());
  check((await shown('Conversations')) === expected.week, `7 days: shows ${await shown('Conversations')}, server has ${expected.week}`);
  check((await shown('Messages')) === expected.weekMessages, `messages: shows ${await shown('Messages')}, server has ${expected.weekMessages}`);
  await section.getByRole('button', { name: 'Past 30 days' }).click();
  await page.waitForTimeout(200);
  check((await shown('Conversations')) === expected.month, `30 days: shows ${await shown('Conversations')}, server has ${expected.month}`);
  check(/Real calls are on the Calls page/.test(await section.innerText()), 'it says these are not the real calls');
});

// ---- Team (ported from Weave React's tests/team.component.test.js)
const dialog = () => page.getByRole('dialog');
const emailField = () => dialog().getByRole('textbox', { name: 'Email address' });
const addEmail = async (email) => {
  await emailField().fill(email);
  await emailField().press('Enter');
};
const row = (email) => page.locator(`tr[data-member="${email}"]`);
const grant = () => dialog().getByTestId('team-grant').innerText();

await step('Team starts with one person, the owner, and says plainly that it is kept in this browser', async () => {
  await page.evaluate(() => localStorage.removeItem('weave_team'));
  await ready('/team', 'Team');
  await page.locator('tbody tr').first().waitFor();
  check((await page.locator('tbody tr').count()) === 1, 'one person');
  check(/Owner[\s\S]*Whole workspace/.test(await row('test.person@example.com').innerText()), await row('test.person@example.com').innerText());
  check((await row('test.person@example.com').getByRole('button').count()) === 0, 'the owner has no change or remove');
  check(
    /Kept in this browser: invitations are not sent and access is not enforced yet/.test(await page.getByTestId('team-note').innerText()),
    'the note says it plainly'
  );
});

await step('inviting asks what they may do and where, and says what that gives', async () => {
  await ready('/team', 'Team');
  await page.getByRole('button', { name: 'Invite people' }).click();
  await dialog().waitFor();
  await addEmail('sam@acme.com');
  await addEmail('kim@acme.com');
  const chips = await dialog().getByTestId('team-emails').locator('li').allInnerTexts();
  check(JSON.stringify(chips.map((c) => c.trim())) === JSON.stringify(['sam@acme.com', 'kim@acme.com']), `chips: ${chips}`);
  check((await emailField().inputValue()) === '', 'the field is empty for the next one');
  check(/Editor: can see, try, change and publish every agent in the workspace, including agents made later/.test(await grant()), await grant());
  await dialog().getByRole('radio', { name: 'Only some agents' }).check();
  check(/Choose at least one agent/.test(await grant()), await grant());
  check(await dialog().getByTestId('member-submit').isDisabled(), 'it cannot be added with no agent');
  await dialog().getByRole('checkbox', { name: 'Acme Support' }).check();
  await dialog().getByRole('checkbox', { name: 'Bookings' }).check();
  check(/2 agents: Acme Support and Bookings\. Nothing else in the workspace/.test(await grant()), await grant());
  await dialog().getByRole('button', { name: 'Add 2 invitations' }).click();
  await dialog().waitFor({ state: 'detached' });
  check(/Editor[\s\S]*Acme Support and 1 more[\s\S]*Invited/.test(await row('sam@acme.com').innerText()), await row('sam@acme.com').innerText());
  check(/Acme Support, Bookings/.test(await row('kim@acme.com').innerText()), await row('kim@acme.com').innerText());
  check(/No email was sent/.test(await page.getByTestId('team-notice').innerText()), 'it says no email was sent');
});

await step('a bad address and someone already on the team are named, and nothing is added', async () => {
  await ready('/team', 'Team');
  await page.getByRole('button', { name: 'Invite people' }).click();
  await dialog().waitFor();
  await addEmail('nope');
  check(/“nope” is not an email address/.test(await dialog().getByTestId('team-email-error').innerText()), 'a bad address is named');
  check((await dialog().getByTestId('team-emails').count()) === 0, 'it was not added');
  await addEmail('test.person@example.com');
  check(/test\.person@example\.com is already on the team/.test(await dialog().getByTestId('team-email-error').innerText()), 'the owner is already in');
  await emailField().fill('lee@acme.com');
  check((await dialog().getByTestId('team-email-error').count()) === 0, 'typing again clears the message');
  await emailField().press('Enter');
  await addEmail('lee@acme.com');
  check(/already on the team/.test(await dialog().getByTestId('team-email-error').innerText()), 'the same address twice is refused');
  await dialog().getByRole('button', { name: 'Remove lee@acme.com' }).click();
  check((await dialog().getByTestId('team-emails').count()) === 0, 'an added address can be taken out');
  await emailField().fill('');
  check(await dialog().getByTestId('member-submit').isDisabled(), 'nothing to add');
  await page.keyboard.press('Escape');
  await dialog().waitFor({ state: 'detached' });
  check((await page.locator('tbody tr').count()) === 3, 'still three people');
});

await step('an admin always has the whole workspace', async () => {
  await ready('/team', 'Team');
  await page.getByRole('button', { name: 'Invite people' }).click();
  await dialog().getByRole('radio', { name: 'Only some agents' }).check();
  await dialog().getByRole('radio', { name: 'Admin' }).check();
  check(await dialog().getByRole('radio', { name: 'Only some agents' }).isDisabled(), '“only some agents” is off for an admin');
  check(await dialog().getByRole('radio', { name: 'The whole workspace' }).isChecked(), 'the whole workspace is chosen');
  check(/Admin: can .* every agent in the workspace/.test(await grant()), await grant());
  await page.keyboard.press('Escape');
});

await step('access can be changed, and a person removed after a confirmation; it survives a reload', async () => {
  await ready('/team', 'Team');
  await page.getByRole('button', { name: 'Change access of Sam' }).click();
  await dialog().waitFor();
  check(await dialog().getByTestId('member-submit').isDisabled(), 'nothing to save until something changes');
  await dialog().getByRole('checkbox', { name: 'Acme Support' }).uncheck();
  await dialog().getByRole('checkbox', { name: 'Front Desk' }).check();
  await dialog().getByRole('radio', { name: 'Viewer' }).check();
  await dialog().getByRole('button', { name: 'Save access' }).click();
  await dialog().waitFor({ state: 'detached' });
  check(/Viewer[\s\S]*Bookings and 1 more/.test(await row('sam@acme.com').innerText()), await row('sam@acme.com').innerText());
  await row('sam@acme.com').getByRole('button', { name: 'Remove Sam' }).click();
  check(/Remove Sam\?/.test(await row('sam@acme.com').innerText()), 'it asks first');
  await row('sam@acme.com').getByRole('button', { name: 'Keep' }).click();
  check(await row('sam@acme.com').isVisible(), 'Keep leaves them');
  await row('sam@acme.com').getByRole('button', { name: 'Remove Sam' }).click();
  await row('sam@acme.com').getByRole('button', { name: 'Remove', exact: true }).click();
  await row('sam@acme.com').waitFor({ state: 'detached' });
  await page.reload();
  await row('kim@acme.com').waitFor();
  check((await row('sam@acme.com').count()) === 0, 'still removed after a reload');
});

await step('the list can be filtered to the people who can open one agent', async () => {
  await ready('/team', 'Team');
  await page.getByRole('button', { name: 'Invite people' }).click();
  await emailField().fill('fd@acme.com');
  await dialog().getByRole('radio', { name: 'Only some agents' }).check();
  await dialog().getByRole('checkbox', { name: 'Front Desk' }).check();
  await dialog().getByRole('button', { name: 'Add invitation' }).click();
  await dialog().waitFor({ state: 'detached' });
  await page.getByRole('combobox', { name: 'Who can open' }).selectOption('front-desk');
  const emails = await page.locator('tbody tr').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-member')).sort());
  check(JSON.stringify(emails) === JSON.stringify(['fd@acme.com', 'test.person@example.com']), `shown: ${emails}`);
});

await finish();
