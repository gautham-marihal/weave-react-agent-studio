// Before the workspace, signed out: the landing page, "Start" for a newcomer, the sign-in (keep me signed in, forgot
// password), the first-time profile step that ends in the Create dialog, a returning person, and a deep link.
// Ported from Weave React's e2e/smoke.mjs and e2e/firstRun.mjs (their sign-in and first-run parts).
//   E2E_API_PORT=8430 E2E_WEB_PORT=5430 node e2e/shell-signin.mjs
import { check, suite } from './support/harness.mjs';

// user: false — this browser is not signed in by the harness
const { page, context, base, step, finish } = await suite('shell-signin', { user: false });

const urlIs = (re, p = page) => p.waitForFunction((src) => new RegExp(src).test(location.pathname + location.search), re.source, { timeout: 15_000 });
const stored = () =>
  page.evaluate(() => ({ local: localStorage.getItem('weave_auth_user'), session: sessionStorage.getItem('weave_auth_user') }));
const signOut = async () => {
  await page.getByRole('banner').getByRole('button', { name: /Your account/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
};

await page.goto(`${base}/`, { timeout: 120_000 }).catch(() => {});

await step('a signed-out visitor at the bare address sees the landing page, with Start and Sign in', async () => {
  await page.goto(`${base}/`);
  await urlIs(/^\/welcome$/);
  await page.getByRole('heading', { level: 1, name: /Turn an idea into an agent/ }).waitFor();
  check(await page.getByRole('link', { name: 'Start', exact: true }).isVisible(), 'Start');
  check(await page.getByRole('link', { name: 'Sign in' }).first().isVisible(), 'Sign in');
  check((await page.title()) === 'Build, test and run AI agents · Weave Studio', `title: ${await page.title()}`);
});

await step('the use-case menu opens, moves with the arrows and closes with Escape', async () => {
  const button = page.getByRole('button', { name: 'Use cases' });
  await button.click();
  const menu = page.getByRole('menu', { name: 'Use cases' });
  await menu.waitFor();
  check((await menu.getByRole('menuitem').count()) >= 4, 'it lists the use cases');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  check(await page.evaluate(() => document.activeElement?.textContent?.includes('Use cases')), 'focus goes back to the button');
});

await step('Start greets a newcomer: “Get started”', async () => {
  await page.getByRole('link', { name: 'Start', exact: true }).click();
  await urlIs(/^\/signin\?start=1$/);
  await page.getByRole('heading', { name: 'Get started with Weave Studio' }).waitFor();
  check(await page.getByText('Build your first agent in minutes.').isVisible(), 'newcomer wording');
  check((await page.title()) === 'Get started · Weave Studio', `title: ${await page.title()}`);
  check(await page.getByText('Sign-in isn’t verified yet.').isVisible(), 'it says sign-in is not checked');
});

await step('“Forgot password?” says plainly there is no password reset yet', async () => {
  const toggle = page.getByRole('button', { name: 'Forgot password?' });
  await toggle.click();
  const panel = page.getByRole('region', { name: 'Reset password' });
  await panel.waitFor();
  check(/There is no password reset yet/.test(await panel.innerText()), await panel.innerText());
  check(await panel.getByRole('button', { name: 'Enter your email or phone above' }).isDisabled(), 'nothing to continue with yet');
  check((await toggle.getAttribute('aria-expanded')) === 'true', 'the toggle says it is open');
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await panel.waitFor({ state: 'detached' });
});

await step('a first sign-in asks for a name and a workspace, then opens “Create an agent”', async () => {
  await page.getByLabel('Email or phone').fill('asha.rao@harbour.example');
  await page.getByLabel('Password').fill('anything');
  check(await page.getByRole('checkbox', { name: 'Keep me signed in' }).isChecked(), 'kept by default');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Welcome to Weave Studio' }).waitFor();
  check((await page.title()) === 'Set up your workspace · Weave Studio', `title: ${await page.title()}`);
  await page.getByRole('button', { name: /Continue to my workspace/ }).click();
  check(await page.getByText('Enter your name.').isVisible(), 'a name is asked for');
  check(await page.getByText('Enter a name for your workspace.').isVisible(), 'a workspace name is asked for');
  await page.getByLabel('What should we call you?').fill('Asha Rao');
  await page.getByLabel('What should we call your workspace?').fill('Harbour Plumbing');
  await page.getByRole('button', { name: /Continue to my workspace/ }).click();
  await page.getByRole('dialog', { name: 'Create an agent' }).waitFor({ timeout: 15_000 });
  check(new URL(page.url()).pathname === '/', `at ${page.url()}`);
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { level: 1, name: /, Asha$/ }).waitFor();
  await page.getByTestId('home-counts').filter({ hasText: /Harbour Plumbing/ }).waitFor();
  check((await page.getByTestId('home-counts').innerText()).trim() === '3 agents in Harbour Plumbing, 2 published.', await page.getByTestId('home-counts').innerText());
});

await step('“Keep me signed in” keeps the profile until sign-out (localStorage), and a reload stays signed in', async () => {
  const s = await stored();
  check(!!s.local && !s.session, `local: ${!!s.local}, session: ${!!s.session}`);
  check(!/password|anything/i.test(s.local), 'no password is kept');
  await page.reload();
  await page.getByRole('heading', { level: 1, name: /, Asha$/ }).waitFor();
});

await step('the Account dialog shows the name, email and workspace from the first sign-in', async () => {
  await page.getByRole('banner').getByRole('button', { name: /Your account: Asha Rao/ }).click();
  await page.getByRole('menuitem', { name: /Account/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Your account' });
  await dialog.waitFor();
  const text = await dialog.innerText();
  check(/Asha Rao/.test(text) && /asha\.rao@harbour\.example/.test(text) && /Harbour Plumbing/.test(text) && /until you sign out/.test(text), text);
  await page.keyboard.press('Escape');
});

await step('signing out and back in with the same email skips the profile step', async () => {
  await signOut();
  await urlIs(/^\/welcome$/);
  check(!(await stored()).local, 'the profile is gone from the browser on sign-out');
  await page.getByRole('link', { name: 'Sign in' }).first().click();
  await page.getByRole('heading', { name: 'Sign in to Weave Studio' }).waitFor();
  check(await page.getByText('Welcome back').isVisible(), 'a returning person is welcomed back');
  await page.getByLabel('Email or phone').fill('ASHA.RAO@harbour.example');
  await page.getByRole('checkbox', { name: 'Keep me signed in' }).uncheck();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: /, Asha$/ }).waitFor();
  check((await page.getByRole('dialog').count()) === 0, 'no Create dialog for a returning person');
});

await step('without “Keep me signed in” the profile lasts only for this browser session (sessionStorage)', async () => {
  const s = await stored();
  check(!s.local && !!s.session, `local: ${!!s.local}, session: ${!!s.session}`);
});

await step('a deep link asks to sign in, then comes back to it', async () => {
  const fresh = await context.browser().newContext({ viewport: { width: 1280, height: 800 } });
  const p = await fresh.newPage();
  try {
    await p.goto(`${base}/calls?agent=acme-support`);
    await urlIs(/^\/signin$/, p);
    await p.getByLabel('Email or phone').fill('kim@harbour.example');
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await p.getByLabel('What should we call you?').fill('Kim');
    await p.getByLabel('What should we call your workspace?').fill('Harbour');
    await p.getByRole('button', { name: /Continue to my workspace/ }).click();
    await urlIs(/^\/$/, p);
    // a newcomer's first stop is Create; a returning person goes back to the link
    await p.getByRole('dialog', { name: 'Create an agent' }).waitFor();
    await p.keyboard.press('Escape');
    await p.getByRole('banner').getByRole('button', { name: /Your account/ }).click();
    await p.getByRole('menuitem', { name: 'Sign out' }).click();
    await p.goto(`${base}/calls?agent=acme-support`);
    await urlIs(/^\/signin$/, p);
    await p.getByLabel('Email or phone').fill('kim@harbour.example');
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await urlIs(/^\/calls\?agent=acme-support$/, p);
  } finally {
    await fresh.close();
  }
});

await step('an address that would lead off the site (//host, /\\host) signs in to Home, never to that host', async () => {
  const fresh = await context.browser().newContext({ viewport: { width: 1280, height: 800 } });
  const p = await fresh.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  try {
    // a returning person, so signing in goes back to the address asked for (a newcomer always lands on Create)
    await p.goto(`${base}/signin`);
    await p.getByLabel('Email or phone').fill('lee@harbour.example');
    await p.getByRole('button', { name: 'Sign in', exact: true }).click();
    await p.getByLabel('What should we call you?').fill('Lee');
    await p.getByLabel('What should we call your workspace?').fill('Harbour');
    await p.getByRole('button', { name: /Continue to my workspace/ }).click();
    await p.getByRole('dialog', { name: 'Create an agent' }).waitFor();
    await p.keyboard.press('Escape');
    for (const hostile of ['//evil.example/steal', '/\\evil.example/steal']) {
      await p.getByRole('banner').getByRole('button', { name: /Your account/ }).click();
      await p.getByRole('menuitem', { name: 'Sign out' }).click();
      await p.goto(`${base}${hostile}`);
      await urlIs(/^\/signin$/, p);
      await p.getByLabel('Email or phone').fill('lee@harbour.example');
      await p.getByRole('button', { name: 'Sign in', exact: true }).click();
      await urlIs(/^\/$/, p);
      await p.getByRole('heading', { level: 1, name: /, Lee$/ }).waitFor();
      check(new URL(p.url()).origin === new URL(base).origin, `${hostile}: still on Weave Studio (${p.url()})`);
    }
    check(errors.length === 0, `no page errors: ${errors.join(' | ')}`);
  } finally {
    await fresh.close();
  }
});

await finish();
