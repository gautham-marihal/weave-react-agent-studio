// Every main page opens signed in, against the stand-in API, without errors.
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish } = await suite('smoke');

const PAGES = [
  ['Home', '/', /Overview|Good (morning|afternoon|evening)/],
  ['Agents', '/agents', /Agents/],
  ['an agent, Build', '/agents/acme-support/build', /Acme Support/],
  ['an agent, Test', '/agents/acme-support/test', /Acme Support/],
  ['an agent, Release', '/agents/acme-support/release', /Acme Support/],
  ['Calls', '/calls', /Calls/],
  ['Live', '/live', /Live/],
  ['Knowledge', '/knowledge', /Knowledge/],
  ['Library', '/library', /Library/],
  ['Settings', '/settings', /Settings/],
];
for (const [name, route, text] of PAGES) {
  await step(`${name} opens`, async () => {
    await page.goto(`${base}${route}`);
    await page.locator('main').waitFor();
    await page.waitForFunction((source) => new RegExp(source).test(document.querySelector('main')?.innerText || ''), text.source, { timeout: 15_000 });
    check(!(await page.getByText('An application error occurred').count()), 'the error screen is showing');
  });
}

await finish();
