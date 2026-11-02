import { describe, expect, it } from 'vitest';
import { findTemplates, highlightSegments, insertAt, insertables, templateProblems, templateScope, wordCount } from './templates';

const config = { state: { variables: { order_number: { type: 'string' }, verified: { type: 'boolean' } } }, constants: { hours: '9 to 5' } };
const scope = templateScope(config);

describe('template text', () => {
  it('finds each {{ … }} with what it starts with and the name after it', () => {
    const found = findTemplates("Order {{ state.order_number | default('none') }} open {{const.hours}}");
    expect(found.map((t) => [t.root, t.name])).toEqual([
      ['state', 'order_number'],
      ['const', 'hours'],
    ]);
    expect(findTemplates('no templates')).toEqual([]);
  });

  it('a name the agent lacks or a root it doesn’t offer is a hint, never an error', () => {
    const problems = templateProblems('{{state.orderid}} {{const.hours}} {{weather.today}} {{}}', scope);
    expect(problems.map((p) => p.text)).toEqual(['{{state.orderid}}', '{{weather.today}}', '{{}}']);
    expect(problems.every((p) => p.severity === 'hint')).toBe(true);
    expect(problems[0].reason).toMatch(/there is order_number, verified/);
    expect(templateProblems('{{call.id}} {{args.anything}}', scope)).toEqual([]);
  });

  it('cuts the text into plain pieces and templates, marking the doubtful ones', () => {
    expect(highlightSegments('Hi {{state.verified}} and {{state.nope}}.', scope).map((s) => s.kind)).toEqual(['plain', 'tpl', 'plain', 'unknown', 'plain']);
  });

  it('inserts where the cursor is, or over the selection, and says where the cursor goes', () => {
    expect(insertAt('Hello world', 6, 6, '{{state.x}} ')).toEqual({ text: 'Hello {{state.x}} world', caret: 18 });
    expect(insertAt('Hello world', 6, 11, 'you')).toEqual({ text: 'Hello you', caret: 9 });
    expect(insertAt('Hi', null, null, '!')).toEqual({ text: 'Hi!', caret: 3 });
  });

  it('offers what it keeps and the fixed values by name, and counts words', () => {
    expect(insertables(scope).map((c) => [c.plain, c.snippet])).toEqual([
      ['Order number', '{{state.order_number}}'],
      ['Verified', '{{state.verified}}'],
      ['Hours', '{{const.hours}}'],
    ]);
    expect(insertables(templateScope({}))).toEqual([]);
    expect(wordCount('  one two\nthree ')).toBe(3);
    expect(wordCount('')).toBe(0);
  });
});
