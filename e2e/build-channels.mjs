// Build › Channels: every channel as a row, Add a channel from the kinds GET /channel-types lists, a channel's own
// settings, a phone line's numbers, the recording-notice question, delete with Undo, business hours and caller identity.
import { check, suite } from './support/harness.mjs';

const { page, base, step, finish } = await suite('build-channels');
const CHANNELS = `${base}/agents/acme-support/build/channels`;
const dialog = () => page.getByRole('dialog');
const rows = () => page.getByRole('region', { name: 'All channels' }).locator('[data-channel]');

await step('a phone number is set up for the agent (stand-in API)', async () => {
  const res = await page.request.post(`${base}/api/bots/acme-support/numbers`, { data: { number: '+15550100', environment: 'development' } });
  check(res.ok(), `the stand-in refused the number: ${res.status()} ${await res.text()}`);
});

await step('the Channels page lists every channel by its kind', async () => {
  await page.goto(CHANNELS);
  await page.getByRole('heading', { name: 'All channels' }).waitFor();
  await rows().first().waitFor();
  check((await rows().count()) >= 1, 'no channel rows');
  check(await rows().filter({ hasText: 'Chat on your website' }).count(), 'the web chat row is not named by its kind');
  check(await rows().first().innerText().then((t) => /Says “/.test(t)), 'the row does not say what it says first');
});

await step('Add a channel offers the kinds the server lists, marking what it has and what does not run', async () => {
  await page.getByRole('button', { name: 'Add a channel' }).click();
  await dialog().getByRole('heading', { name: 'Add a channel' }).waitFor();
  const card = (id) => dialog().locator(`[data-preset="${id}"]`);
  check(/Not available yet/.test(await card('whatsapp').innerText()), 'WhatsApp is not marked as not available yet');
  check(/Already added/.test(await card('web_chat').innerText()), 'web chat is not marked as already added');
  check(!/Already added|Not available/.test(await card('phone').innerText()), 'phone calls is marked');
  await card('phone').click();
  await dialog().getByRole('heading', { name: 'Phone calls' }).waitFor();
});

await step('a phone line shows the numbers callers dial', async () => {
  await dialog().locator('[data-note="numbers"]').filter({ hasText: 'Callers dial +15550100 (development)' }).waitFor();
  await dialog().getByRole('button', { name: 'Done' }).click();
  await rows().filter({ hasText: 'Callers dial +15550100' }).waitFor();
});

await step('adding a voice channel asks about a recording notice, and the answer writes it', async () => {
  const offer = page.getByRole('group', { name: 'Recording notice' });
  await offer.waitFor();
  check(/Tell callers they may be recorded\?/.test(await offer.innerText()), 'the question is not asked');
  await offer.getByRole('button', { name: 'Add a notice' }).click();
  await offer.waitFor({ state: 'detached' });
  await page.getByRole('navigation', { name: 'Build sections' }).getByRole('link', { name: /After the call/ }).click();
  const notice = page.getByPlaceholder('This call may be recorded to improve our service.');
  await notice.waitFor();
  check((await notice.inputValue()) === 'This call may be recorded to improve our service.', 'the notice is not in the draft');
  await page.getByRole('navigation', { name: 'Build sections' }).getByRole('link', { name: /Channels/ }).click();
  await page.getByRole('heading', { name: 'All channels' }).waitFor();
});

await step('a channel offers only what its kind can carry, and an option changes the draft', async () => {
  await rows().filter({ hasText: 'Phone calls' }).click();
  const person = dialog().getByRole('group', { name: 'From the person' });
  check((await person.getByRole('checkbox').count()) === 1, 'a phone line offers more than voice');
  const keypad = dialog().getByRole('switch', { name: 'Keypad tones' });
  check((await keypad.getAttribute('aria-checked')) === 'true', 'the keypad is not on for a new phone line');
  await keypad.click();
  check((await keypad.getAttribute('aria-checked')) === 'false', 'the keypad did not switch off');
  check(!(await dialog().getByRole('switch', { name: 'Show forms' }).count()), 'a phone line offers forms');
  await dialog().getByRole('button', { name: 'Done' }).click();
  await rows().filter({ hasText: 'Chat on your website' }).click();
  check((await dialog().getByRole('group', { name: 'From the person' }).getByRole('checkbox').count()) === 4, 'a web chat does not offer voice, text, pictures and video');
  check((await dialog().getByRole('switch', { name: 'Show forms' }).count()) === 1, 'a web chat does not offer forms');
  check(!(await dialog().getByRole('switch', { name: 'Keypad tones' }).count()), 'a web chat offers a keypad');
  await dialog().getByRole('button', { name: 'Done' }).click();
});

await step('changing a channel’s kind asks first when settings would be cleared', async () => {
  await rows().filter({ hasText: 'Chat on your website' }).click();
  await dialog().getByText('Technical details').click();
  await dialog().getByRole('combobox', { name: 'Kind of channel' }).selectOption('sip_voice');
  const ask = dialog().getByRole('alertdialog', { name: 'Change the kind of channel' });
  await ask.waitFor();
  check(/the widget id field/.test(await ask.innerText()), `the question does not name what is cleared: ${await ask.innerText()}`);
  await ask.getByRole('button', { name: 'Cancel' }).click();
  check((await dialog().getByRole('combobox', { name: 'Kind of channel' }).inputValue()) === 'web_chat', 'the kind changed without asking');
  await dialog().getByRole('button', { name: 'Done' }).click();
});

await step('deleting a channel can be undone', async () => {
  const before = await rows().count();
  await rows().filter({ hasText: 'Phone calls' }).click();
  await dialog().getByRole('button', { name: 'Delete channel' }).click();
  await page.getByText('Channel “Phone calls” deleted.').waitFor();
  check((await rows().count()) === before - 1, 'the row is still there');
  await page.getByRole('status').filter({ hasText: 'deleted' }).getByRole('button', { name: 'Undo' }).click();
  await rows().filter({ hasText: 'Phone calls' }).waitFor();
  check((await rows().count()) === before, 'Undo did not bring it back');
});

await step('business hours start from Monday to Friday, 9 to 5, show the week, and say nothing follows them', async () => {
  await page.getByRole('button', { name: 'Start with Monday to Friday, 9 to 5' }).click();
  const hours = page.locator('[data-schedule="business_hours"]');
  await hours.waitFor();
  check((await hours.locator('[data-week]').innerText()) === 'Monday to Friday 09:00–17:00.', 'the week is not described');
  check(await hours.getByText('Not used', { exact: true }).count(), 'the unused flag is missing');
  const zone = await hours.getByLabel('Time zone').inputValue();
  check(zone !== '', 'no time zone was set');
  await hours.getByRole('group', { name: 'Days of window 1' }).getByRole('button', { name: 'Saturday' }).click();
  check((await hours.locator('[data-week]').innerText()) === 'Monday to Saturday 09:00–17:00.', 'ticking Saturday did not change the week');
  await hours.getByRole('textbox', { name: 'Closes (window 1)' }).fill('18:00');
  check((await hours.locator('[data-week]').innerText()) === 'Monday to Saturday 09:00–18:00.', 'the closing time did not change the week');
  await hours.getByLabel('Date').fill('2026-12-25');
  await hours.getByRole('button', { name: 'Add the day' }).click();
  await hours.getByRole('listitem').filter({ hasText: '2026-12-25 Closed all day' }).waitFor();
});

await step('caller identity is switched on with the phone number, and written in international form', async () => {
  const identity = page.locator('#identity');
  await identity.getByRole('switch', { name: 'Read who is calling' }).click();
  const words = identity.locator('[data-note="caller-id"]');
  check((await words.innerText()).startsWith('It reads who is calling from the call’s “sip.phoneNumber”'), `unexpected: ${await words.innerText()}`);
  await identity.getByRole('button', { name: 'International form' }).click();
  await identity.getByRole('textbox', { name: 'Default country' }).fill('gb');
  check(/taken as GB/.test(await words.innerText()), 'the default country is not said');
  await identity.getByRole('button', { name: 'Move source 2 up' }).click();
  check((await words.innerText()).startsWith('It reads who is calling from the caller’s identity'), 'reordering did not change the order');
});

await step('every change is one draft edit: the page is unsaved and Undo takes the last one back', async () => {
  const words = page.locator('#identity [data-note="caller-id"]');
  const before = await words.innerText();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await page.waitForFunction((text) => document.querySelector('#identity [data-note="caller-id"]')?.textContent !== text, before);
});

await finish();
