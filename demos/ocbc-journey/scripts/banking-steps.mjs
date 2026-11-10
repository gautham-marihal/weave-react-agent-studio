// The OCBC journey's banking steps, for the end-to-end runners: driving the real agent through the studio's Test panel
// as a customer would, answering whatever the agent asks next (the words vary from run to run; the facts must not).
// Used by ../../unbound/use-case-1/scripts/run-e2e.mjs (UB_JOURNEY=ocbc: the new customer goes on to banking once the
// account is open) and by run-banking-e2e.mjs (existing customers).

const PHONE_CODE_ASKED = /phone banking (number|code)|phone code|7-digit/i;
const PIN_ASKED = /\b(T?PIN|passcode)\b/i;

/** The helpers both runners pass: page, panel, say, until, textOf, newText, check, at, getJson, postJson. */
export function steps(h) {
  // on a voice call the panel shows only the latest caption: open the whole transcript once (it stays open), so each
  // reply can be read as on a chat
  const openTranscript = async () => {
    const toggle = h.page.locator(`${h.panel} .pvTranscriptToggle[aria-expanded="false"]`);
    if (await toggle.count()) {
      await toggle.first().click();
      await h.page.waitForTimeout(500);
    }
  };
  // the agent's messages are counted by their "Agent" labels, not by where the text stands: a voice panel re-renders
  // as it speaks, so positions shift, but the count of messages only grows
  const LABEL = /\bAgent\b/g;
  const agentMessages = async () => ((await h.textOf(h.panel)).match(LABEL) || []).length;
  // everything from the (n+1)-th agent message on
  const fromMessage = (text, n) => {
    let at = -1;
    for (let k = 0; k <= n; k++) {
      at = text.indexOf('Agent', at + 1);
      if (at < 0) return '';
    }
    return text.slice(at);
  };
  // what the agent said after its first `seen` messages, once it has finished a reply (no change for 4 seconds)
  const reply = async (seen, ms = 60000) => {
    let last = '';
    let still = 0;
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await h.page.waitForTimeout(1000);
      const text = await h.textOf(h.panel);
      const now = (text.match(LABEL) || []).length > seen ? fromMessage(text, seen) : '';
      still = now && now === last ? still + 1 : 0;
      last = now;
      if (still >= 4) break;
    }
    return last;
  };
  // one customer turn: the words, then the agent's whole reply (without the customer's own words)
  const turn = async (words, ms) => {
    await openTranscript();
    const seen = await agentMessages();
    await h.say(words);
    return (await reply(seen, ms)).trim();
  };
  // a short conversation: after each reply, the first answer whose question matches is said; until done matches
  const converse = async (opening, answers, done, turns = 8) => {
    let text = await turn(opening);
    let all = text;
    for (let i = 0; i < turns && !done.test(text); i++) {
      const next = answers.find(([asked]) => asked.test(text));
      if (!next) {
        // nothing to answer and not done: the agent may still be working ("one moment"); wait once for its next message
        const later = await reply(await agentMessages(), 25000);
        if (!later) break;
        text = later;
        all += ` ${text}`;
        continue;
      }
      text = await turn(typeof next[1] === 'function' ? next[1](text) : next[1]);
      all += ` ${text}`;
    }
    return all;
  };
  const db2 = async (entity, method, columnMap) =>
    (await h.postJson('/ocbc/dboperations', { ucid: 'e2e', dnis: 'default', channel: 'IVR', entity, method, details: [{ columnMap }] })).responseList || [];

  // sign in with the phone banking number and the TPIN, answering in whatever order the agent asks
  const signIn = (opening, code, tpin, done) =>
    converse(
      opening,
      [
        [PHONE_CODE_ASKED, `My phone banking number is ${code}.`],
        [PIN_ASKED, `My PIN is ${tpin}.`],
      ],
      done,
      4,
    );

  return {
    turn,
    converse,
    db2,
    signIn,

    /** A customer just onboarded (UC1 runner, UB_JOURNEY=ocbc): the new account, the temporary PIN, the card. */
    async afterOpening({ mail, sms }) {
      const code = mail?.body.match(/phone banking number is (\d{7})/)?.[1];
      const tpin = sms?.body.match(/PIN is (\d{6})/)?.[1];
      h.check(
        'the welcome e-mail gives the phone banking number; the temporary PIN comes only by SMS',
        !!code && !!tpin && !mail.body.includes(tpin),
        `number ${code || '?'} | SMS to ${sms?.to || '?'}`,
      );
      if (!code || !tpin) return;
      const [account] = await db2('account', 'getCustomerAccounts', { customerId: code });
      const said = await signIn('Thank you. Can I check my new account now?', code, tpin, /SGD\s?0(\.00)?\b|0\.00|deposit/i);
      h.check('hand-over to Banking, which signs the customer in with the number and the temporary PIN', PHONE_CODE_ASKED.test(said) && PIN_ASKED.test(said));
      h.check(
        'the new account: SGD 0.00, the first deposit not in yet, arranged by the relationship manager',
        /0\.00/.test(said) && /deposit/i.test(said) && (!account?.note || said.includes(account.note.match(/: (\S+ \S+) arranges/)?.[1] || '')),
        said.slice(-260),
      );
      h.check('the PIN is never said back', !said.includes(tpin));

      // the customer changes the temporary PIN on this first call
      const NEW_PIN = '246813';
      const changed = await converse(
        'I’d like to change my temporary PIN, please.',
        [
          // the read-back first (it may name the new PIN too); then the current PIN when the question doesn't name the
          // new one ("your current PIN once more"); then the new PIN, first or again
          [/shall I|should I|go ahead|do you want me to|would you like me to/i, 'Yes, please.'],
          [/^(?![\s\S]*\bnew\b)[\s\S]*\b(current|existing|temporary)\b/i, `It’s ${tpin}.`],
          [/\bnew\b/i, NEW_PIN],
        ],
        /successfully changed/i,
      );
      const [after] = await db2('customer', 'getCustomerDetails', { customerId: code });
      h.check(
        'the temporary PIN is changed, with a read-back first',
        /successfully changed/i.test(changed) && after?.passcode === NEW_PIN,
        changed.slice(-200),
      );
      h.check('the new PIN is never said back', !changed.includes(NEW_PIN) && !changed.includes(NEW_PIN.split('').join(' ')));

      // the debit card: Cards, without a second sign-in
      const card = await turn('And when will my debit card arrive?');
      h.check(
        'hand-over to Cards: the date the debit card arrives, no second sign-in',
        /\d{1,2} \w+ 20\d\d|working days|arrive/i.test(card) && !PHONE_CODE_ASKED.test(card) && !PIN_ASKED.test(card),
        card.slice(0, 220),
      );
    },
  };
}
