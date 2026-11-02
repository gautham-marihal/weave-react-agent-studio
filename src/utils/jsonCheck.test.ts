import { describe, expect, it } from 'vitest';
import {
  checkJson,
  describeDuplicates,
  errorLinesOf,
  findDuplicateKeys,
  jsonProblems,
  lineOf,
  locatePath,
  offsetOfLine,
  parsePathText,
  syntaxErrorLine,
  syntaxErrorOffset } from
'./jsonCheck';

const line = (text: string) => (offset: number) => text.slice(0, offset).split('\n').length;
const parseMessage = (text: string) => {
  try {
    JSON.parse(text);
  } catch (e) {
    return (e as Error).message;
  }
  return '';
};

describe('a syntax error', () => {
  const text = '{\n  "a": 1\n  "b": 2\n}';
  it('is put on its line: the one the browser names, else the line of the position it names', () => {
    expect(syntaxErrorLine(parseMessage(text), text)).toBe(3);
    expect(syntaxErrorLine("Expected ',' or '}' after property value in JSON at position 11 (line 3 column 3)", text)).toBe(3);
    expect(syntaxErrorLine('Unexpected string in JSON at position 11', text)).toBe(3);
    expect(syntaxErrorLine('Unexpected end of JSON input', text)).toBeNull();
    expect(syntaxErrorLine(undefined, text)).toBeNull();
  });

  it('is marked on the word the browser points at, not one character', () => {
    const message = parseMessage(text);
    expect(syntaxErrorOffset(message, text)).toBe(13);
    expect(syntaxErrorOffset("Expected ',' or '}' after property value in JSON at position 13 (line 3 column 3)", text)).toBe(13);
    expect(syntaxErrorOffset('Unexpected string in JSON at position 11', text)).toBe(11);
    expect(syntaxErrorOffset('Unexpected end of JSON input', text)).toBeNull();
    const [problem, ...more] = jsonProblems(text, { error: message }, null);
    expect(more).toHaveLength(0);
    expect(text.slice(problem.from, problem.to)).toBe('"b"');
    expect(problem.severity).toBe('error');
    expect(problem.message).toBe(message);
    expect([...errorLinesOf(text, [problem])]).toEqual([3]);
  });

  it('is what checkJson reports, with its line; a value that is not an object is refused', () => {
    const r = checkJson(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.line).toBe(3);
    const arr = checkJson('[1, 2]');
    expect(arr.ok).toBe(false);
    expect(checkJson('{"a": 1}')).toEqual({ ok: true, value: { a: 1 } });
  });
});

describe('a key written twice', () => {
  it('is marked at both places, with the sentence the studio says', () => {
    const text = '{\n  "name": "A",\n  "name": "B"\n}';
    const duplicates = findDuplicateKeys(text);
    const problems = jsonProblems(text, { error: 'The key appears twice', duplicates }, null);
    expect(problems.map((p) => text.slice(p.from, p.to))).toEqual(['"name"', '"name"']);
    expect(problems.map((p) => lineOf(text, p.from))).toEqual([2, 3]);
    expect(problems[0].message).toMatch(/The key “name” appears twice in the top level, on lines 2 and 3/);
  });

  it('is held back by checkJson: the draft keeps the last good version (JSON.parse would silently keep the last)', () => {
    const text = '{"timeout": 5, "timeout": 30}';
    expect((JSON.parse(text) as {timeout: number;}).timeout).toBe(30);
    const r = checkJson(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/“timeout” appears twice in the top level/);
      expect(r.duplicates).toHaveLength(1);
    }
  });

  it('finds nothing in valid JSON with no repeats, however nested', () => {
    const text = JSON.stringify({ a: 1, b: { a: 2, c: [{ a: 3 }, { a: 4 }] }, d: [1, 2, { x: null, y: true }] }, null, 2);
    expect(findDuplicateKeys(text)).toEqual([]);
    expect(findDuplicateKeys('{}')).toEqual([]);
    expect(findDuplicateKeys('[]')).toEqual([]);
    expect(findDuplicateKeys('  42  ')).toEqual([]);
  });

  it('is found with the path of its object, its key and both positions', () => {
    const text = '{\n  "meta": {\n    "id": "a",\n    "name": "x",\n    "id": "b"\n  }\n}';
    const [dup, ...rest] = findDuplicateKeys(text);
    expect(rest).toHaveLength(0);
    expect(dup.path).toEqual(['meta']);
    expect(dup.key).toBe('id');
    expect(line(text)(dup.firstOffset)).toBe(3);
    expect(line(text)(dup.offset)).toBe(5);
    expect(text.slice(dup.offset, dup.offset + 4)).toBe('"id"');
  });

  it('goes through arrays as indexes; the same key in different objects is fine', () => {
    const found = findDuplicateKeys('{"agents":{"items":[{"id":"a"},{"id":"b","id":"c"}]},"id":1}');
    expect(found).toHaveLength(1);
    expect(found[0].path).toEqual(['agents', 'items', 1]);
    expect(found[0].key).toBe('id');
  });

  it('reports several repeats in the order they appear', () => {
    const found = findDuplicateKeys('{"a":1,"a":2,"b":{"c":1,"c":2},"a":3}');
    expect(found.map((f) => [f.path.join('.'), f.key])).toEqual([
    ['', 'a'],
    ['b', 'c'],
    ['', 'a']]);

  });

  it('treats keys equal after unescaping as equal; a lookalike inside a string is not a key', () => {
    expect(findDuplicateKeys('{"a\\u0062":1,"ab":2}')).toHaveLength(1);
    expect(findDuplicateKeys('{"a\\"b":1,"a\\"b":2}')).toHaveLength(1);
    expect(findDuplicateKeys('{"a":"\\"b\\":1,\\"b\\":2","b":3}')).toEqual([]);
    expect(findDuplicateKeys('{"a":"x,\\"a\\":1"}')).toEqual([]);
  });

  it('gives what was found before a problem in text that is not JSON, and never throws', () => {
    expect(findDuplicateKeys('{"a":1,"a":2,')).toHaveLength(1);
    expect(findDuplicateKeys('{not json')).toEqual([]);
    expect(findDuplicateKeys('')).toEqual([]);
    expect(() => findDuplicateKeys('{"a":')).not.toThrow();
    expect(() => findDuplicateKeys('[[[{"a"')).not.toThrow();
  });

  it('is named in a sentence: the key, the object, both lines and how many more', () => {
    const text = '{\n"a": {\n  "x": 1,\n  "x": 2\n},\n"b": 1,\n"b": 2\n}';
    const message = describeDuplicates(findDuplicateKeys(text), line(text));
    expect(message).toMatch(/“x” appears twice in a, on lines 3 and 4 \(and 1 more\)/);
    expect(message).toMatch(/nothing is saved, validated or published/);
    const nested = '{"agents":{"items":[{"id":1,"id":2}]}}';
    expect(describeDuplicates(findDuplicateKeys(nested), line(nested))).toMatch(/in agents\.items\[0\]/);
  });

  it('is looked for quickly in a large document', () => {
    const big = JSON.stringify({ items: Array.from({ length: 20000 }, (_, i) => ({ id: `i${i}`, text: 'hello "world"', n: i })) });
    const started = Date.now();
    expect(findDuplicateKeys(big)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('the server’s problems in the text', () => {
  it('are marked at the setting they name, errors and warnings, on its first line', () => {
    const text = JSON.stringify({ meta: { name: 'A' }, tools: [{ id: 't', kind: 'http' }] }, null, 2);
    const report = {
      errors: [
      { path: ['tools', 0, 'kind'], message: 'Unknown kind' },
      { path: [], message: 'not about a place' }],

      warnings: [{ path: ['tools', 0], message: 'No description' }]
    };
    const problems = jsonProblems(text, {}, report);
    expect(problems.map((p) => [p.severity, text.slice(p.from, p.to), p.message])).toEqual([
    ['error', '"http"', 'Unknown kind'],
    ['warning', '{', 'No description']]);

    expect(jsonProblems(text, {}, null)).toEqual([]);
  });
});

describe('a path in the text', () => {
  const text = JSON.stringify({ agents: { entry: 'a', items: [{ id: 'a' }, { id: 'b', tools: ['x'] }] } }, null, 2);
  it('is found as the span of its value, or the nearest part that exists', () => {
    const span = locatePath(text, ['agents', 'items', 1, 'tools']);
    expect(span && text.slice(span[0], span[1]).replace(/\s/g, '')).toBe('["x"]');
    const near = locatePath(text, ['agents', 'items', 1, 'nope']);
    expect(near && text.slice(near[0], near[0] + 1)).toBe('{');
    expect(locatePath(text, [])?.[0]).toBe(0);
  });
  it('can be typed as words: dots, brackets or bare numbers', () => {
    expect(parsePathText('agents.items[1].tools')).toEqual(['agents', 'items', 1, 'tools']);
    expect(parsePathText('tools.2.id')).toEqual(['tools', 2, 'id']);
    expect(parsePathText('  ')).toBeNull();
  });
  it('knows where each line starts', () => {
    expect(offsetOfLine('a\nb\nc', 3)).toBe(4);
    expect(offsetOfLine('a', 9)).toBe(1);
  });
});
