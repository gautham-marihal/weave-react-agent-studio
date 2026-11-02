import { describe, expect, it } from 'vitest';
import { SCHEMA } from '../test/schemaKeys';
import { unknownKeys } from '../test/schemaKeys';
import {
  ACTION_KINDS,
  changeKind,
  describeAction,
  describeCondition,
  describeRule,
  isSimpleCondition,
  kindLabel,
  makeAction,
  moveItem,
  readCondition,
  typedValue,
  writeCondition,
} from './effects';

type Json = Record<string, unknown>;

describe('effects in words', () => {
  it('has a plain name for every kind of step the schema allows, and invents none', () => {
    const defs = SCHEMA.$defs as Record<string, Json>;
    const resolve = (s: Json): Json => (typeof s.$ref === 'string' ? defs[s.$ref.split('/').pop() ?? ''] : s);
    const types = ((defs.action.oneOf as Json[]) ?? []).map((b) => String(((resolve(b).properties as Json).type as Json).const)).sort();
    expect(ACTION_KINDS.map((k) => k.type).sort()).toEqual(types);
    expect(new Set(ACTION_KINDS.map((k) => k.label)).size).toBe(ACTION_KINDS.length);
    expect(kindLabel('end_call')).toBe('End the call');
    expect(kindLabel('mystery')).toBe('mystery');
  });

  it('makes a new step of each kind with only the server’s keys', () => {
    ACTION_KINDS.forEach(({ type }) => expect(unknownKeys({ tools: [{ id: 't', type: 'builtin', builtin: 'noop', effects: [{ do: [makeAction(type)] }] }] })).toEqual([]));
    expect(changeKind({ type: 'say', text: 'Hi' }, 'end_call')).toEqual({ type: 'end_call' });
    expect(changeKind({ type: 'handoff', to: 'billing' }, 'say')).toEqual({ type: 'say', text: '' });
    expect(changeKind({ type: 'http', connection: 'api', method: 'POST', path: '/x' }, 'http')).toEqual({ type: 'http', connection: 'api', method: 'POST', path: '/x' });
  });

  it('writes a step as a short sentence', () => {
    expect(describeAction({ type: 'say', text: 'Done!' })).toBe('Say “Done!”');
    expect(describeAction({ type: 'say', text: { message: 'bye' } })).toBe('Say the message “bye”');
    expect(describeAction({ type: 'set_state', values: { outcome: 'paid', tries: 2 } })).toBe('Set outcome to “paid”, tries to 2');
    expect(describeAction({ type: 'handoff', to: 'billing' })).toBe('Hand off to billing');
    expect(describeAction({ type: 'end_call', say: 'Goodbye' })).toBe('Say “Goodbye”, then end the call');
    expect(describeAction({ type: 'end_call' })).toBe('End the call');
    expect(describeAction({ type: 'handoff' })).toBe('Hand off to an agent (none chosen yet)');
    expect(describeAction({ type: 'http', connection: 'api', method: 'POST', path: '/x' })).toBe('Call POST /x on api');
    expect(describeAction(null)).toBe('Do something');
  });

  it('writes a rule as one sentence: when it applies, then its steps in order', () => {
    expect(describeRule({ do: [{ type: 'say', text: 'Hi' }, { type: 'end_call' }] })).toBe('Always: say “Hi”, then end the call.');
    expect(describeRule({ when: { result: '$.status', equals: 'ok' }, do: [{ type: 'set_state', values: { paid: true } }] })).toBe('When the result $.status is “ok”: set paid to true.');
    expect(describeRule({ do: [] })).toBe('Always: nothing yet');
    expect(describeCondition({ state: 'verified', not_equals: null })).toBe('the state verified is set');
    expect(describeCondition({ all: [{ state: 'a', equals: 1 }, { channel: 'phone' }] })).toBe('the state a is 1 and the channel is “phone”');
  });

  it('moves an item', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
    const same = ['a', 'b'];
    expect(moveItem(same, 0, -1)).toBe(same);
    expect(moveItem(same, 1, 2)).toBe(same);
  });
});

describe('a simple condition as one row', () => {
  it('knows a simple condition from one the row can’t show', () => {
    expect(isSimpleCondition({ state: 'verified', equals: true })).toBe(true);
    expect(isSimpleCondition({ state: '' })).toBe(true);
    expect(isSimpleCondition({ all: [] })).toBe(false);
    expect(isSimpleCondition({ state: 'a', arg: 'b', equals: 1 })).toBe(false);
    expect(isSimpleCondition({ channel: 'phone' })).toBe(false);
  });

  it('changes one part and keeps the rest; the value follows the comparison', () => {
    const c = readCondition({ state: 'tries', equals: '3' });
    expect(c).toEqual({ source: 'state', subject: 'tries', operator: 'equals', value: '3' });
    expect(writeCondition(c, { operator: 'gte' })).toEqual({ state: 'tries', gte: 3 });
    expect(writeCondition(c, { operator: 'in' })).toEqual({ state: 'tries', in: [] });
    expect(writeCondition(c, { source: 'arg' })).toEqual({ arg: '', equals: '3' });
    expect(writeCondition(readCondition(undefined), { subject: 'verified', value: true })).toEqual({ state: 'verified', equals: true });
    expect(typedValue('true')).toBe(true);
    expect(typedValue('null')).toBeNull();
    expect(typedValue('42')).toBe(42);
    expect(typedValue('NB-1')).toBe('NB-1');
  });
});
