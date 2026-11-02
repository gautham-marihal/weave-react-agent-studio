// “Describe it” with an AI model set up. The test can't call a real model, so Studio's /llm route is pointed at a tiny
// local stand-in for the Messages API (LLM_BASE_URL, set for this test only) that edits the draft it is sent: it makes
// the persona formal and adds a rule. The stand-in checks what the route forwards (the key added on the server, an
// allowed model, no forced tool choice). Ports: the API and web ports, and E2E_LLM_PORT (default 8526).
//   E2E_API_PORT=8426 E2E_WEB_PORT=5426 E2E_LLM_PORT=8526 node e2e/workflow-describe.mjs
import http from 'node:http';
import { check, suite } from './support/harness.mjs';

const LLM_PORT = Number(process.env.E2E_LLM_PORT || 8526);
const KEY = 'e2e-key-not-real';
const seen = [];

// The stand-in Messages API: answers with a submit_config tool call made from the draft in the request.
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    seen.push({ url: req.url, key: req.headers['x-api-key'], version: req.headers['anthropic-version'], body });
    const first = String(body.messages?.[0]?.content ?? '');
    const draftText = first.split('CURRENT DRAFT (edit this; keep what the request does not touch):\n')[1]?.split('\n\nREQUEST:\n')[0] ?? '{}';
    const request = first.split('\n\nREQUEST:\n')[1] ?? '';
    const reply = (status, json) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    if (/OVERLOAD/.test(request)) return reply(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
    const config = JSON.parse(draftText);
    config.persona = { ...config.persona, tone: 'formal', style_rules: [...(config.persona?.style_rules ?? []), 'Never promise a refund.'] };
    // asked to break first: an answer the server's checks refuse, then the fixed one when the problems come back
    if (/BREAK FIRST/.test(request) && body.messages.length === 1) config.agents = { ...config.agents, entry: 'nobody_here' };
    reply(200, {
      id: `msg_${seen.length}`,
      type: 'message',
      role: 'assistant',
      model: body.model,
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: `toolu_${seen.length}`, name: 'submit_config', input: { config, summary: 'Made it more formal and added a rule about refunds.', assumptions: ['English stays the main language.'], questions: ['Should Spanish callers get the same rule?'] } },
      ],
      usage: { input_tokens: 120, output_tokens: 60 },
    });
  });
});
await new Promise((resolve) => fake.listen(LLM_PORT, '127.0.0.1', resolve));

// Studio's dev server reads these when the harness starts it (only for this test; nothing in Studio defaults to them).
process.env.ANTHROPIC_API_KEY = KEY;
process.env.LLM_BASE_URL = `http://127.0.0.1:${LLM_PORT}`;
process.env.LLM_MODELS = '';
process.env.LLM_MODEL = '';

const { page, base, step, finish, errors } = await suite('workflow-describe');
const dialog = () => page.getByRole('dialog', { name: 'Describe it' });
const saveButton = () => page.getByRole('button', { name: 'Save', exact: true });
const ask = async (text) => {
  await dialog().getByLabel('What should change?').fill(text);
  await dialog().getByRole('button', { name: 'Propose a change' }).click();
};
const lastProposal = () => dialog().getByRole('region', { name: 'Proposal' }).last();

await step('/llm/status says an AI model is set up, which models may be chosen, and never the key', async () => {
  await page.goto(`${base}/agents/acme-support/build`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const status = await page.evaluate(async () => (await fetch('/llm/status')).text());
  const json = JSON.parse(status);
  check(json.configured === true, 'configured');
  check(json.model === 'claude-opus-5-5', `the newest model is the default (${json.model})`);
  check(JSON.stringify(json.models) === JSON.stringify(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']), `allowed: ${json.models}`);
  check(!status.includes(KEY), 'the key is not in the answer');
});

await step('Describe it opens from the agent header and asks once before anything is sent', async () => {
  await page.getByRole('button', { name: 'Describe it' }).click();
  await dialog().waitFor({ timeout: 5000 });
  await dialog().getByText('Before you use it').waitFor({ timeout: 10000 });
  check(await dialog().getByLabel('What should change?').isDisabled(), 'nothing can be sent before agreeing');
  await dialog().getByRole('button', { name: 'I understand, continue' }).click();
  check(await page.evaluate(() => localStorage.getItem('weave_ai_consent')) === '1', 'the answer is kept in this browser');
  check(await dialog().getByLabel('AI model').inputValue() === 'claude-opus-5-5', 'the newest model is chosen');
});

await step('a request becomes a proposal, checked by the server and shown as changes in words; the draft is untouched', async () => {
  await ask('Make it sound more formal and add a rule: never promise a refund.');
  const proposal = lastProposal();
  await proposal.getByText('Made it more formal and added a rule about refunds.').waitFor({ timeout: 20000 });
  await proposal.getByText('What it would change').waitFor();
  check(/Personality/.test(await proposal.innerText()), 'grouped by part of the agent');
  check(/“formal”/.test(await proposal.innerText()), 'the new tone is said in words');
  await proposal.getByText('English stays the main language.').waitFor();
  await proposal.getByText('Should Spanish callers get the same rule?').waitFor();
  await proposal.getByText(/The server’s checks pass/).waitFor();
  check(await saveButton().isDisabled(), 'nothing is in the draft before Apply');
});

await step('the route added the key, kept to an allowed model, and sent no forced tool choice', async () => {
  const last = seen[seen.length - 1];
  check(last.url === '/v1/messages', last.url);
  check(last.key === KEY, 'the key was added by the server');
  check(last.version === '2023-06-01', 'the API version header');
  check(last.body.model === 'claude-opus-5-5', last.body.model);
  check(last.body.tool_choice?.type === 'auto', JSON.stringify(last.body.tool_choice));
  check(!('temperature' in last.body), 'no sampling settings');
  check(last.body.tools?.[0]?.name === 'submit_config', 'the one tool');
  const browserSent = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/llm/')).map((e) => e.name));
  check(browserSent.every((u) => !u.includes('anthropic.com')), 'the browser only talks to Studio');
});

await step('Apply puts it in the draft through the editor, and Undo takes it back', async () => {
  await lastProposal().getByRole('button', { name: 'Apply' }).click();
  await lastProposal().getByText('Applied to the draft').waitFor({ timeout: 3000 });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Save' && !b.disabled), null, { timeout: 5000 });
  await lastProposal().getByRole('button', { name: 'Undo' }).click();
  await lastProposal().getByText('Undone').waitFor({ timeout: 3000 });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Save' && b.disabled), null, { timeout: 5000 });
});

await step('problems the server finds are handed back to the model, and the fixed answer is the one shown', async () => {
  const before = seen.length;
  await ask('Make it formal. BREAK FIRST');
  await lastProposal().getByText('Made it more formal and added a rule about refunds.').waitFor({ timeout: 20000 });
  check(seen.length === before + 2, `two calls to the model (${seen.length - before})`);
  const repair = seen[seen.length - 1].body.messages;
  check(repair.length === 3 && repair[2].content[0].type === 'tool_result' && repair[2].content[0].is_error === true, 'the second call carries what the checks found');
  check(/agents\.entry/.test(repair[2].content[0].content), repair[2].content[0].content);
  check(seen[seen.length - 1].body.messages[0].content.includes('Earlier in this session'), 'what was asked before goes with it');
  await lastProposal().getByText(/The server’s checks pass/).waitFor();
});

await step('Not this leaves the draft as it is', async () => {
  await lastProposal().getByRole('button', { name: 'Not this' }).click();
  await lastProposal().getByText('Not applied').waitFor({ timeout: 3000 });
  check(await saveButton().isDisabled(), 'still nothing to save');
});

await step('when the AI service fails, it says so in words and changes nothing', async () => {
  await ask('OVERLOAD please');
  await lastProposal().getByRole('alert').getByText(/The AI service is having trouble/).waitFor({ timeout: 20000 });
  check(await saveButton().isDisabled(), 'nothing changed');
});

await step('applied and saved, the change is in the server’s draft', async () => {
  await ask('Make it sound more formal.');
  await lastProposal().getByRole('button', { name: 'Apply' }).click();
  await dialog().getByRole('button', { name: 'Close', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Save' && b.disabled), null, { timeout: 15000 });
  const config = (await (await page.request.get(`${base}/api/bots/acme-support/draft`)).json()).config;
  check(config.persona.tone === 'formal', `tone: ${config.persona.tone}`);
  check(config.persona.style_rules.includes('Never promise a refund.'), 'the rule');
});

await step('an address with ?describe= opens it at once with the words in the box (what the Create dialog uses)', async () => {
  await page.goto(`${base}/agents/acme-support/build?describe=${encodeURIComponent('A friendly receptionist for a dental clinic')}`, { waitUntil: 'domcontentloaded' });
  await dialog().waitFor({ timeout: 30000 });
  check(await dialog().getByLabel('What should change?').inputValue() === 'A friendly receptionist for a dental clinic', 'the words are in the box');
  await page.waitForFunction(() => !new URLSearchParams(location.search).has('describe'), null, { timeout: 3000 });
});

for (let i = errors.length - 1; i >= 0; i -= 1) if (errors[i].includes('ToastItem')) errors.splice(i, 1);
await finish();
fake.close();
