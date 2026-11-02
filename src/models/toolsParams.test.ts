import { describe, expect, it } from 'vitest';
import { PARAM_KINDS, argNamesOf, bodyFromParams, modelView, paramProblems, readParams, writeParams, type ParamRow } from './toolsParams';
import { describeMatches, evalPath, findTemplates, insertAt, insertables, joinUrl, modelSees, parsePath, samplePaths, templateProblems, templateScope, validatePath } from './toolsPaths';

const row = (r: Partial<ParamRow>): ParamRow => ({ name: '', kind: 'string', description: '', choices: [], required: false, extra: {}, ...r });

describe('parameters as rows', () => {
  it('turns rows into a JSON Schema and back, without losing anything', () => {
    const schema = {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City to look up' },
        units: { type: 'string', enum: ['c', 'f'], description: 'Temperature units' },
        days: { type: 'integer' },
        urgent: { type: 'boolean' },
      },
      required: ['city', 'days'],
    };
    const { rows, canEdit, rest } = readParams(schema);
    expect(canEdit).toBe(true);
    expect(rows.map((r) => [r.name, r.kind, r.required])).toEqual([
      ['city', 'string', true],
      ['units', 'choice', false],
      ['days', 'integer', true],
      ['urgent', 'boolean', false],
    ]);
    expect(rows[1].choices).toEqual(['c', 'f']);
    expect(writeParams(rows, rest)).toEqual(schema);
  });

  it('keeps keywords the rows don’t show, and does not flatten structured parameters', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        zip: { type: 'string', pattern: '^\\d{5}$', description: 'ZIP' },
        filters: { type: 'array', items: { type: 'string' } },
        nested: { type: 'object', properties: { a: { type: 'string' } } },
      },
    };
    const { rows, rest } = readParams(schema);
    expect(rest.additionalProperties).toBe(false);
    expect(rows[0].extra).toEqual({ pattern: '^\\d{5}$' });
    expect(rows[1].kind).toBe('advanced');
    expect(rows[2].kind).toBe('advanced');
    expect(writeParams(rows, rest)).toEqual(schema);
  });

  it('follows edits to the rows', () => {
    const { rows, rest } = readParams({ type: 'object', properties: {} });
    rows.push(row({ name: 'color', kind: 'choice', description: 'Favourite colour', choices: ['red', 'blue', ''], required: true }));
    rows.push(row({ name: 'age', kind: 'number' }));
    expect(writeParams(rows, rest)).toEqual({
      type: 'object',
      properties: { color: { type: 'string', description: 'Favourite colour', enum: ['red', 'blue'] }, age: { type: 'number' } },
      required: ['color'],
    });
    expect(writeParams([], {})).toEqual({ type: 'object', properties: {} });
    expect(readParams(undefined).rows).toHaveLength(0);
    expect(readParams({ type: 'array' }).canEdit).toBe(false);
    expect(readParams('nope').canEdit).toBe(false);
    expect(PARAM_KINDS).toHaveLength(5);
  });

  it('names problems with the rows; a missing description is only a hint', () => {
    const found = paramProblems([
      row({ name: '', description: 'x' }),
      row({ name: 'Bad Name', description: 'x' }),
      row({ name: 'ok' }),
      row({ name: 'ok', description: 'dup' }),
      row({ name: 'pick', kind: 'choice', description: 'x' }),
    ]);
    expect(found.map((f) => [f.index, f.level ?? 'error'])).toEqual([
      [0, 'error'],
      [1, 'error'],
      [2, 'hint'],
      [3, 'error'],
      [4, 'error'],
    ]);
  });

  it('shows what the model sees for the parameters, and builds a body from them', () => {
    const { rows } = readParams({ type: 'object', properties: { city: { type: 'string', description: 'City' }, units: { type: 'string', enum: ['c', 'f'] } }, required: ['city'] });
    const view = modelView({ name: 'get_weather', description: 'Look up the weather.', rows });
    expect(view.signature).toBe('get_weather(city, units)');
    expect(view.params).toEqual(['city (text, required): City', 'units (one of: c, f, optional)']);
    expect(bodyFromParams(rows)).toEqual({ city: '{{args.city}}', units: '{{args.units}}' });
    expect(argNamesOf({ parameters: { properties: { a: {}, b: {} } } })).toEqual(['a', 'b']);
  });
});

describe('templates in a request', () => {
  it('finds templates with their root and name, filters and spacing included', () => {
    const found = findTemplates("Hi {{ state.name | default('there') }}, order {{args.order_id}} {{const.url}} {{ call.id }}");
    expect(found.map((t) => [t.root, t.name])).toEqual([
      ['state', 'name'],
      ['args', 'order_id'],
      ['const', 'url'],
      ['call', 'id'],
    ]);
    expect(findTemplates('just {{ }}')[0].root).toBe('');
    expect(findTemplates('no templates, just {braces}')).toHaveLength(0);
    expect(findTemplates(undefined)).toEqual([]);
  });

  it('hints at a name the config doesn’t have, with what there is instead', () => {
    const config = { state: { variables: { intent: {}, verified: {} } }, constants: { pay_url: 'x' } };
    const scope = templateScope(config, { argNames: ['order_id'] });
    expect(templateProblems('{{state.intent}} {{const.pay_url}} {{args.order_id}} {{result.balance}}', scope)).toEqual([]);
    const bad = templateProblems('{{state.intnt}} {{args.nope}} {{const.x}} {{foo.bar}}', scope);
    expect(bad).toHaveLength(4);
    expect(bad[0].reason).toMatch(/“intnt” isn’t a state variable \(there is intent, verified\)/);
    expect(bad[1].reason).toMatch(/argument of this tool/);
    expect(bad[2].reason).toMatch(/constant/);
    expect(bad[3].reason).toMatch(/“foo” isn’t a name this config offers here/);
    expect(templateProblems('{{args.anything}}', templateScope(config))).toEqual([]);
  });

  it('inserts a snippet at the caret or over the selection, and offers the names there are', () => {
    expect(insertAt('hello world', 6, 6, '{{state.x}}')).toEqual({ text: 'hello {{state.x}}world', caret: 17 });
    expect(insertAt('hello world', 6, 11, 'X')).toEqual({ text: 'hello X', caret: 7 });
    expect(insertAt('abc', undefined, undefined, '!')).toEqual({ text: 'abc!', caret: 4 });
    const chips = insertables(templateScope({ state: { variables: { a: {} } }, constants: { c: 1 } }, { argNames: ['q'] }));
    expect(chips.map((c) => c.label)).toEqual(['args.q', 'state.a', 'const.c']);
    expect(joinUrl('https://x.test/api/', '/orders/{{args.id}}', { a: '1' })).toBe('https://x.test/api/orders/{{args.id}}?a=1');
    expect(joinUrl('', '', {})).toBe('…');
  });
});

describe('response paths', () => {
  const response = { balance: 42.5, customer: { name: 'Asha', 'tax-id': 'T1' }, items: [{ id: 1, tags: ['a', 'b'] }, { id: 2 }], note: null };

  it('reads the supported grammar, and says what isn’t supported', () => {
    expect(parsePath('$.a.b')).toEqual([{ key: 'a' }, { key: 'b' }]);
    expect(parsePath("$.a[0]['x-y'][*]")).toEqual([{ key: 'a' }, { index: 0 }, { key: 'x-y' }, { all: true }]);
    expect(parsePath('$')).toEqual([]);
    const cases: [string, RegExp][] = [
      ['', /Enter a path/],
      ['$..a', /search everywhere/],
      ['$.a[?(@.x>1)]', /Filters/],
      ['$.a[0:2]', /Slices/],
      ['$.a[', /never closed/],
      ['$.', /field name/],
      ['a..b', /search everywhere/],
    ];
    cases.forEach(([text, why]) => {
      const r = validatePath(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(why);
    });
  });

  it('reads a bare field name as $.name, the way the runtime does', () => {
    expect(parsePath('found')).toEqual([{ key: 'found' }]);
    expect(parsePath('items[*].id')).toEqual([{ key: 'items' }, { all: true }, { key: 'id' }]);
    expect(parsePath('$.customer.tax-id')).toEqual([{ key: 'customer' }, { key: 'tax-id' }]);
    expect(modelSees({ found: true, summary: 'Order NB-1003, shipped', extra: 1 }, ['found', 'summary'])).toEqual({
      whole: false,
      value: { found: true, summary: 'Order NB-1003, shipped' },
      missing: [],
    });
  });

  it('picks the right values, and nothing when they don’t match', () => {
    expect(evalPath(response, '$.balance')).toEqual([42.5]);
    expect(evalPath(response, "$.customer['tax-id']")).toEqual(['T1']);
    expect(evalPath(response, '$.items[*].id')).toEqual([1, 2]);
    expect(evalPath(response, '$.items[0].tags[1]')).toEqual(['b']);
    expect(evalPath(response, '$.nope.deeper')).toEqual([]);
    expect(evalPath(response, '$.note')).toEqual([null]);
  });

  it('turns a sample response into paths to pick, and says what each picks', () => {
    const paths = samplePaths(response).map((p) => p.path);
    expect(paths).toEqual(['$.balance', '$.customer.name', "$.customer['tax-id']", '$.items[*]', '$.items[*].id', '$.items[*].tags[*]', '$.note']);
    paths.forEach((p) => expect(validatePath(p).ok).toBe(true));
    expect(samplePaths({ list: Array.from({ length: 500 }, (_, i) => ({ id: i })) })).toHaveLength(2);
    expect(modelSees(response, [])).toEqual({ whole: true, value: response, missing: [] });
    const named = modelSees(response, ['$.balance', '$.items[*].id', '$.gone', '$.bad[']);
    expect(named.value).toEqual({ '$.balance': 42.5, '$.items[*].id': [1, 2] });
    expect(named.missing).toEqual(['$.gone', '$.bad[']);
    expect(describeMatches(response, '$.balance').text).toBe('42.5');
    expect(describeMatches(response, '$.items[*].id').text).toMatch(/2 values: 1, 2/);
    expect(describeMatches(response, '$.zzz').ok).toBe(false);
  });
});
