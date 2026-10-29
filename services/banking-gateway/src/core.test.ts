import { describe, expect, it } from 'vitest';
import { verifyChain, type AuditRecord, AuditLog } from './audit/audit.ts';
import { parseDecimal, speakAmount } from './domain/money.ts';
import { collapseRates, speakBand } from './domain/rates.ts';
import { greetingPeriod, localParts } from './domain/time.ts';
import { digits, integer, object, oneOf, string, validate } from './schema/schema.ts';
import { CaptureService } from './security/capture.ts';
import { signLiveKitToken, verifyLiveKitToken } from './security/crypto.ts';
import { leaksIdentifiers, maskTail, redactArgs, stripFirewalled } from './security/redact.ts';
import { isAffirmative } from './tools/transaction-tools.ts';

describe('schema', () => {
  const schema = object({ account: digits(12, 'acct', { identifier: true }), page: integer({ min: 1, max: 5 }), kind: oneOf(['a', 'b'] as const), note: string({ maxLength: 5 }) }, ['account']);

  it('accepts and normalises valid input', () => {
    expect(validate(schema, { account: '5000 0000-0101', page: '2', kind: 'a' })).toEqual({ ok: true, value: { account: '500000000101', page: 2, kind: 'a' } });
  });

  it('rejects unknown fields, wrong formats and control characters, without echoing values', () => {
    const r = validate(schema, { account: '123', page: 9, kind: 'z', extra: 'x', note: 'a‮b' });
    expect(r.ok).toBe(false);
    const text = JSON.stringify(r);
    expect(text).toContain('extra: is not an allowed field'.split(':')[0]);
    expect(text).not.toContain('"123"');
    if (!r.ok) expect(r.issues.map((i) => i.path).sort()).toEqual(['account', 'extra', 'kind', 'note', 'page']);
  });

  it('publishes a closed JSON schema for the model', () => {
    expect(schema.toJson()).toMatchObject({ type: 'object', required: ['account'], additionalProperties: false });
  });
});

describe('money and rates', () => {
  it('reads SGD as dollars and cents, FCY as "point", JPY without decimals, and keeps the sign separate', () => {
    expect(speakAmount({ minor: 123405, currency: 'SGD' })).toEqual({ display: 'SGD 1,234.05', spoken: '1,234 dollars and 5 cents', negative: false });
    expect(speakAmount({ minor: 5, currency: 'SGD' }).spoken).toBe('5 cents');
    expect(speakAmount({ minor: 98050, currency: 'EUR' }).spoken).toBe('980 point 50 euros');
    expect(speakAmount({ minor: 1200, currency: 'JPY' }).spoken).toBe('1,200 yen');
    expect(speakAmount({ minor: -182005, currency: 'SGD' })).toMatchObject({ display: '-SGD 1,820.05', spoken: '1,820 dollars and 5 cents', negative: true });
  });

  it('parses host decimals without floating point and refuses extra precision', () => {
    expect(parseDecimal('1234.5', 'SGD')).toEqual({ minor: 123450, currency: 'SGD' });
    expect(parseDecimal('-0.07', 'SGD')).toEqual({ minor: -7, currency: 'SGD' });
    expect(() => parseDecimal('1.005', 'SGD')).toThrow();
  });

  it('collapses equal consecutive tenors (deck p24 example)', () => {
    const bands = collapseRates([{ months: 2, rate: '5.0' }, { months: 1, rate: '5' }, { months: 3, rate: '10' }, { months: 4, rate: '15' }]);
    expect(bands.map(speakBand)).toEqual(['For 1 to 2 months, 5 percent', 'For 3 months, 10 percent', 'For 4 months, 15 percent']);
  });

  it('uses Singapore time for greetings whatever the server zone', () => {
    expect(greetingPeriod(Date.parse('2026-10-27T03:59:00Z'))).toBe('morning'); // 11:59 SGT
    expect(greetingPeriod(Date.parse('2026-10-27T04:00:00Z'))).toBe('afternoon');
    expect(greetingPeriod(Date.parse('2026-10-27T10:00:00Z'))).toBe('evening');
    expect(localParts(Date.parse('2026-10-27T16:30:00Z'))).toMatchObject({ date: '2026-10-28', weekday: 3, hour: 0 });
  });
});

describe('security primitives', () => {
  it('capture tokens are single-use, session-bound and expire', () => {
    const c = new CaptureService(1_000);
    const a = c.issue('s1', 'pin', 0);
    expect(c.claim(a.token, '135790', 's2', 1)).toMatchObject({ ok: false, reason: 'wrong_session' });
    expect(c.claim(a.token, '135790', 's1', 1)).toMatchObject({ ok: true, value: '135790' });
    expect(c.claim(a.token, '135790', 's1', 2)).toMatchObject({ ok: false, reason: 'unknown_or_used' });
    const b = c.issue('s1', 'otp', 0);
    expect(c.claim(b.token, '123456', 's1', 1_000)).toMatchObject({ ok: false, reason: 'expired' });
    const d = c.issue('s1', 'pin', 0);
    expect(c.claim(d.token, '12', 's1', 1)).toMatchObject({ ok: false, reason: 'bad_format' });
  });

  it('issuing a capture revokes the previous one', () => {
    const c = new CaptureService(10_000);
    const first = c.issue('s1', 'pin', 0);
    c.issue('s1', 'pin', 0);
    expect(c.claim(first.token, '135790', 's1', 1).ok).toBe(false);
  });

  it('accepts only correctly signed, unexpired LiveKit tokens with a room grant', () => {
    const t = signLiveKitToken({ identity: 'u', room: 'r1', ttlS: 60 }, 'secret', 0);
    expect(verifyLiveKitToken(t, 'secret', 1_000)).toMatchObject({ room: 'r1', identity: 'u' });
    expect(verifyLiveKitToken(t, 'other', 1_000)).toBeNull();
    expect(verifyLiveKitToken(t, 'secret', 61_000)).toBeNull();
    const [h, , s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'u', exp: 9e9, video: { room: 'other', roomJoin: true } })).toString('base64url');
    expect(verifyLiveKitToken(`${h}.${forged}.${s}`, 'secret', 1_000)).toBeNull();
  });

  it('redacts secrets, masks identifiers and strips firewalled fields at any depth', () => {
    const props = object({ account_number: digits(12, 'a', { identifier: true }), note: string({ maxLength: 9, sensitive: true }) }).properties;
    expect(redactArgs({ account_number: '500000000101', note: 'x', pin: '1' }, props)).toEqual({ account_number: '••••0101', note: '[redacted]', pin: '[redacted]' });
    expect(stripFirewalled({ a: 1, otp: '1', nested: [{ nric: 'x', ok: true }] })).toEqual({ a: 1, nested: [{ ok: true }] });
    expect(maskTail('12')).toBe('••');
    expect(leaksIdentifiers({ x: 'acct 500000000101' })).toBe(true);
    expect(leaksIdentifiers({ x: 'S1234567D' })).toBe(true);
    expect(leaksIdentifiers({ x: '••••0101', cheque: '100005' })).toBe(false);
  });

  it('detects a tampered or deleted audit record', () => {
    const records: AuditRecord[] = [];
    const log = new AuditLog([(r) => records.push(r)], () => 0);
    for (let i = 0; i < 3; i++) log.write({ sessionId: 's', callId: 'c', kind: 'tool', action: `a${i}`, outcome: 'ok', detail: {} });
    expect(verifyChain(records)).toBe(-1);
    expect(verifyChain([records[0]!, { ...records[1]!, outcome: 'failed' }, records[2]!])).toBe(1);
    expect(verifyChain([records[0]!, records[2]!])).toBe(1);
  });

  it('treats only an explicit, un-negated yes as a confirmation', () => {
    for (const yes of ['Yes', 'yes please do', '"Yes, go ahead."', 'confirm', '1', '是的', 'ok']) expect(isAffirmative(yes)).toBe(true);
    for (const no of ['no', 'yes but cancel it', 'not yet', 'wait', 'maybe', 'yes... actually don\'t', '取消', '']) expect(isAffirmative(no)).toBe(false);
  });
});
