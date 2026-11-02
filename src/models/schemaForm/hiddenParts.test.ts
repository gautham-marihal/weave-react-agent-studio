import { describe, expect, it } from 'vitest';
import { hiddenParts } from './hiddenParts';
import { formatPath, orderedSet, parseSettingPath, singular, uniqueId } from './paths';

// What the form keeps when a section is reset or a setting deleted: the parts another control on the page asks for.
describe('hidden parts', () => {
  it('keeps only the parts asked elsewhere, as copies', () => {
    const value = { enabled: true, entities: ['card_number'], keep_days: 30 };
    const kept = hiddenParts(value, 'post_call.redaction', new Set(['post_call.redaction.entities', 'post_call.summary.enabled']));
    expect(kept).toEqual({ entities: ['card_number'] });
    expect(kept?.entities).not.toBe(value.entities);
  });

  it('keeps nested parts at their place, and nothing when none is set or none is asked', () => {
    expect(hiddenParts({ a: { b: 1, c: 2 } }, 'x', ['x.a.b'])).toEqual({ a: { b: 1 } });
    expect(hiddenParts({ a: 1 }, 'x', ['x.z'])).toBeUndefined();
    expect(hiddenParts({ a: 1 }, 'x', null)).toBeUndefined();
    expect(hiddenParts('text', 'x', ['x.a'])).toBeUndefined();
  });
});

describe('places and keys', () => {
  it('a place is written the way a developer writes it, and read back from a link', () => {
    expect(formatPath(['channels', 0, 'modalities', 'input'])).toBe('channels[0].modalities.input');
    expect(formatPath([])).toBe('');
    expect(parseSettingPath('channels[0].modalities.input')).toEqual(['channels', 0, 'modalities', 'input']);
    expect(parseSettingPath('agents.items.1.tools')).toEqual(['agents', 'items', 1, 'tools']);
    expect(parseSettingPath('  ')).toEqual([]);
  });

  it('a new key goes in the schema’s order; an existing one keeps its place', () => {
    expect(Object.keys(orderedSet({ c: 1, a: 1 }, 'b', 2, ['a', 'b', 'c']))).toEqual(['a', 'b', 'c']);
    expect(Object.keys(orderedSet({ c: 1, a: 1 }, 'c', 2, ['a', 'b', 'c']))).toEqual(['c', 'a']);
  });

  it('new items are named from their list, with a counter', () => {
    expect(singular('tools')).toBe('tool');
    expect(singular('entries')).toBe('entry');
    expect(singular('knowledge')).toBe('knowledge');
    expect(uniqueId(['tool_1'], 'tool')).toBe('tool_2');
    expect(uniqueId([], 'Web chat')).toBe('web_chat_1');
  });
});
