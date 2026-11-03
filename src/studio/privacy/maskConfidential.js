// Confidential details in a conversation the studio shows (the Test tab and its captions, the Preview, call transcripts,
// the trace, the Live board, test results). A PIN, passcode, code, one-time password or ID number shows as ****; an account
// or card number as **** and its last four digits, so it can still be told apart. Only what is shown is masked: the
// records themselves are untouched, so a test made from a call still has what the caller said. Pure: no React.

export const MASK = '****';

// digits as a caller types or says them: "246810", "2468 10", "2 4 6 8 1 0" (single spaces or hyphens between)
const DIGITS = String.raw`\d(?:[ -]?\d)*`;
const FOUR_OR_MORE_DIGITS = String.raw`\d(?:[ -]?\d){3,}`;
// the words before a number that make it a secret
const SECRET_WORDS = String.raw`t-?pin|pin|passcode|password|pass code|otp|one[- ]time password|code|ic|nric|mykad|id number|identity number`;
const AFTER_SECRET_WORD = new RegExp(String.raw`(\b(?:${SECRET_WORDS})\b\D{0,20}?)(${FOUR_OR_MORE_DIGITS}[A-Za-z]?)`, 'gi');
// a Singapore NRIC or FIN written in full: S1234567A
const NRIC = /\b[STFGM]\d{7}[A-Z]\b/gi;
// six or more digits said as words: "two four six eight one zero" (a PIN, a code). An account's last four, which agents
// say aloud on purpose ("ending three three four four"), is shorter and stays.
const SPOKEN = String.raw`(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)`;
const SPOKEN_DIGITS = new RegExp(String.raw`\b${SPOKEN}(?:[\s,-]+${SPOKEN}){5,}\b`, 'gi');
// a run of digits standing alone (not part of a date, a time, an amount with a point, or a word); a full stop or comma
// that ends the sentence ("it is 5409881.") still leaves it alone
const RUN = new RegExp(String.raw`(?<![\d.,:/])${DIGITS}(?![\d:/]|[.,]\d|[ -]\d)`, 'g');
// three or more digits said as words, hidden when they answer a question for a secret ("one two three four")
const SPOKEN_SHORT = new RegExp(String.raw`\b${SPOKEN}(?:[\s,-]+${SPOKEN}){2,}\b`, 'gi');
// What is never a secret, though it has as many digits as one: a date written with hyphens, a reference a service gives
// ("STP-000002", or said "S T P dash zero zero zero zero zero two") and a cheque number. The line is split around them,
// and they are kept as they are.
const DATE = String.raw`\b\d{4}-\d{2}-\d{2}\b`;
const REFERENCE = String.raw`\b[A-Z]{2,5}-\d{3,8}\b`;
const SPOKEN_REFERENCE = String.raw`\b(?:[A-Z][ -]){1,4}[A-Z][ -]+dash(?:[ ,-]+${SPOKEN}){3,8}\b`;
const CHEQUE_NUMBER = String.raw`\b[Cc]heque(?: number| no\.?)?[ :]+\d{6}\b`;
const SPOKEN_CHEQUE_NUMBER = String.raw`\b[Cc]heque(?: number| no\.?)?(?:[ ,-]+${SPOKEN}){6}\b`;
const AROUND_KEPT = new RegExp(`(${DATE}|${REFERENCE}|${SPOKEN_REFERENCE}|${CHEQUE_NUMBER}|${SPOKEN_CHEQUE_NUMBER})`);

// what an agent says when it asks for something secret, so the caller's next line is masked whole
const ASKS_FOR_SECRET = [
  /\b(pin|t-?pin|passcode|password|otp|nric|identity)\b/i,
  /\b(one[- ]time|ic number|id number|key (it )?in)\b/i,
  /\b(phone|key|access|security|verification)( banking)? code\b/i,
  /\b(customer|user) (id|number)\b/i,
];
const asksForSecret = (text) => typeof text === 'string' && ASKS_FOR_SECRET.some((words) => words.test(text));

const digitCount = (text) => (text.match(/\d/g) || []).length;
const lastFour = (text) => text.replace(/\D/g, '').slice(-4);

/** A run of digits as it is shown: 8 or more (an account, a card, an ID) keep their last four; 6 or 7 (a PIN, a code) are hidden. */
function maskRun(run) {
  const count = digitCount(run);
  if (count >= 8) return `${MASK}${lastFour(run)}`;
  if (count >= 6) return MASK;
  return run;
}

/** One line with its confidential details masked. `whole`: the line answers a question for a secret, so every number in it is hidden. */
export function maskText(text, { whole = false } = {}) {
  if (typeof text !== 'string' || !text) return text;
  // split() with a captured group puts what is kept at the odd places
  return text
    .split(AROUND_KEPT)
    .map((part, index) => (index % 2 ? part : maskPart(part, whole)))
    .join('');
}

function maskPart(text, whole) {
  let out = text
    .replace(NRIC, MASK)
    .replace(AFTER_SECRET_WORD, (_, before) => `${before}${MASK}`)
    .replace(SPOKEN_DIGITS, MASK);
  // the last characters of an NRIC ("321B"), when they answer a question for them
  if (whole) out = out.replace(/\b\d{3}[A-Za-z]\b/g, MASK).replace(SPOKEN_SHORT, MASK);
  return out.replace(RUN, (run) => (whole && digitCount(run) >= 3 ? MASK : maskRun(run)));
}

const CALLER = new Set(['user', 'caller', 'customer']);
const AGENT = new Set(['bot', 'agent', 'assistant']);

/**
 * The lines of a conversation with confidential details masked, in order. A caller's line right after the agent asked
 * for a PIN, code or ID number is masked whole. Each line keeps everything else it had.
 *   lines: [{ role?, who?, text }]; roleOf: how to read a line's speaker ('caller' | 'agent' | anything else)
 */
export function maskConversation(lines, roleOf = (line) => line?.role ?? line?.who) {
  let asked = false;
  return (Array.isArray(lines) ? lines : []).map((line) => {
    const role = String(roleOf(line) ?? '').toLowerCase();
    if (AGENT.has(role)) {
      asked = asksForSecret(line.text);
      return { ...line, text: maskText(line.text) };
    }
    if (CALLER.has(role)) {
      const masked = maskText(line.text, { whole: asked });
      asked = false;
      return masked === line.text ? line : { ...line, text: masked };
    }
    return line;
  });
}

/** The rows of a call's trace (trace/records.js) with what was said masked, everything else as it was. */
export const maskTraceRows = (rows) => maskConversation(rows, (row) => (row?.kind === 'user_said' ? 'caller' : row?.kind === 'agent_said' ? 'agent' : ''));
