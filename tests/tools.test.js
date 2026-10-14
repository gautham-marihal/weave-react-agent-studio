import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { argNamesOf, findTemplates, highlightSegments, insertAt, insertables, templateProblems, templateScope } from '../src/studio/form/templates.js';
import { describeMatches, evalPath, modelSees, parsePath, samplePaths, validatePath } from '../src/studio/form/jsonPaths.js';
import { PARAM_KINDS, bodyFromParams, modelView, problems, readParams, writeParams } from '../src/studio/form/paramSchema.js';
import { BUILTIN_HELP, agentsUsingTool, describeAdvice, kindOfTool, notAvailable, timeoutAdvice, unusedTools } from '../src/studio/form/toolInfo.js';

const example = () => JSON.parse(readFileSync(new URL('./fixtures/agent-config.example.json', import.meta.url), 'utf8'));

// ---- templates ---------------------------------------------------------------------------------------------------------
test('templates are found with their root and name, filters and spacing included', () => {
  const found = findTemplates("Hi {{ state.name | default('there') }}, order {{args.order_id}} {{const.url}} {{ call.id }}");
  assert.deepEqual(found.map((t) => [t.root, t.name]), [['state', 'name'], ['args', 'order_id'], ['const', 'url'], ['call', 'id']]);
  assert.equal(findTemplates('no templates, just {braces} and {{ }}')[0].root, ''); // an empty template is found, and has no root
  assert.equal(findTemplates('no templates, just {braces}').length, 0);
  assert.deepEqual(findTemplates(undefined), []);
});

test('a name the config doesn’t have is flagged, with what there is instead', () => {
  const config = { state: { variables: { intent: {}, verified: {} } }, constants: { pay_url: 'x' } };
  const scope = templateScope(config, { argNames: ['order_id'] });
  assert.deepEqual(templateProblems('{{state.intent}} {{const.pay_url}} {{args.order_id}} {{result.balance}}', scope), []);
  const bad = templateProblems('{{state.intnt}} {{args.nope}} {{const.x}} {{foo.bar}}', scope);
  assert.equal(bad.length, 4);
  assert.match(bad[0].reason, /“intnt” isn’t a state variable \(there is intent, verified\)/);
  assert.match(bad[1].reason, /argument of this tool/);
  assert.match(bad[2].reason, /constant/);
  assert.match(bad[3].reason, /“foo” isn’t something a template can read/);
  // outside a tool any argument name is possible
  assert.deepEqual(templateProblems('{{args.anything}}', templateScope(config)), []);
});

test('highlighting cuts the text into plain pieces and templates, bad ones marked', () => {
  const scope = templateScope({ state: { variables: { a: {} } } });
  const segments = highlightSegments('x {{state.a}} y {{state.b}} z', scope);
  assert.deepEqual(segments.map((s) => s.kind), ['plain', 'tpl', 'plain', 'bad', 'plain']);
  assert.equal(segments.map((s) => s.text).join(''), 'x {{state.a}} y {{state.b}} z'); // nothing is lost
});

test('inserting puts the snippet at the caret or over the selection', () => {
  assert.deepEqual(insertAt('hello world', 6, 6, '{{state.x}}'), { text: 'hello {{state.x}}world', caret: 17 });
  assert.deepEqual(insertAt('hello world', 6, 11, 'X'), { text: 'hello X', caret: 7 });
  assert.deepEqual(insertAt('abc', undefined, undefined, '!'), { text: 'abc!', caret: 4 });
  const chips = insertables(templateScope({ state: { variables: { a: {} } }, constants: { c: 1 } }, { argNames: ['q'] }));
  assert.deepEqual(chips.map((c) => c.label), ['args.q', 'state.a', 'const.c']);
  assert.deepEqual(argNamesOf({ parameters: { properties: { a: {}, b: {} } } }), ['a', 'b']);
});

// ---- response paths ---------------------------------------------------------------------------------------------------------
const response = { balance: 42.5, customer: { name: 'Asha', 'tax-id': 'T1' }, items: [{ id: 1, tags: ['a', 'b'] }, { id: 2 }], note: null };

test('the supported path grammar is read, and what isn’t supported says so', () => {
  assert.deepEqual(parsePath('$.a.b'), [{ key: 'a' }, { key: 'b' }]);
  assert.deepEqual(parsePath("$.a[0]['x-y'][*]"), [{ key: 'a' }, { index: 0 }, { key: 'x-y' }, { all: true }]);
  assert.deepEqual(parsePath('$'), []);
  for (const [text, why] of [['', /Enter a path/], ['balance', /starts with \$/], ['$..a', /search everywhere/], ['$.a[?(@.x>1)]', /Filters/], ['$.a[0:2]', /Slices/], ['$.a-b', /Unexpected/], ['$.a[', /never closed/], ['$.', /field name/]]) {
    const result = validatePath(text);
    assert.equal(result.ok, false, text);
    assert.match(result.error, why, text);
  }
});

test('paths pick the right values out of a response, and nothing when they don’t match', () => {
  assert.deepEqual(evalPath(response, '$.balance'), [42.5]);
  assert.deepEqual(evalPath(response, '$.customer.name'), ['Asha']);
  assert.deepEqual(evalPath(response, "$.customer['tax-id']"), ['T1']);
  assert.deepEqual(evalPath(response, '$.items[*].id'), [1, 2]);
  assert.deepEqual(evalPath(response, '$.items[0].tags[1]'), ['b']);
  assert.deepEqual(evalPath(response, '$.items[1].tags'), []);
  assert.deepEqual(evalPath(response, '$.nope.deeper'), []);
  assert.deepEqual(evalPath(response, '$.note'), [null]);
  assert.deepEqual(evalPath(response, '$.items[5]'), []);
});

test('a sample response is turned into the paths a person can pick', () => {
  const paths = samplePaths(response).map((p) => p.path);
  assert.deepEqual(paths, ['$.balance', '$.customer.name', "$.customer['tax-id']", '$.items[*]', '$.items[*].id', '$.items[*].tags[*]', '$.note']);
  for (const path of paths) assert.equal(validatePath(path).ok, true, path); // every path it offers is one the runtime reads
  assert.deepEqual(samplePaths('x'), [{ path: '$', kind: 'string', preview: 'x' }]);
  assert.equal(samplePaths(Object.fromEntries(Array.from({ length: 500 }, (_, i) => ['k' + i, i])), { max: 5 }).length, 5);
  assert.equal(samplePaths({ list: Array.from({ length: 500 }, (_, i) => ({ id: i })) }).length, 2); // a list is shown once, as [*], through its first item
});

test('"what the model sees": only the fields named, the whole response when none are, and what matched nothing', () => {
  assert.deepEqual(modelSees(response, []), { whole: true, value: response, missing: [] });
  const named = modelSees(response, ['$.balance', '$.items[*].id', '$.gone', '$.bad[']);
  assert.deepEqual(named.value, { '$.balance': 42.5, '$.items[*].id': [1, 2] });
  assert.deepEqual(named.missing, ['$.gone', '$.bad[']);
  assert.equal(named.whole, false);
  assert.equal(describeMatches(response, '$.balance').text, '42.5');
  assert.match(describeMatches(response, '$.items[*].id').text, /2 values: 1, 2/);
  assert.equal(describeMatches(response, '$.zzz').ok, false);
});

// ---- parameters ---------------------------------------------------------------------------------------------------------------
test('rows become a JSON Schema and back, without losing anything', () => {
  const schema = { type: 'object', properties: { city: { type: 'string', description: 'City to look up' }, units: { type: 'string', enum: ['c', 'f'], description: 'Temperature units' }, days: { type: 'integer' }, urgent: { type: 'boolean' } }, required: ['city', 'days'] };
  const { rows, canEdit, rest } = readParams(schema);
  assert.equal(canEdit, true);
  assert.deepEqual(rows.map((r) => [r.name, r.kind, r.required]), [['city', 'string', true], ['units', 'choice', false], ['days', 'integer', true], ['urgent', 'boolean', false]]);
  assert.deepEqual(rows[1].choices, ['c', 'f']);
  assert.deepEqual(writeParams(rows, rest), schema);
});

test('keywords the rows don’t show are kept, and structured parameters are not flattened', () => {
  const schema = { type: 'object', additionalProperties: false, properties: { zip: { type: 'string', pattern: '^\\d{5}$', description: 'ZIP' }, filters: { type: 'array', items: { type: 'string' } }, nested: { type: 'object', properties: { a: { type: 'string' } } } } };
  const { rows, rest } = readParams(schema);
  assert.equal(rest.additionalProperties, false);
  assert.deepEqual(rows[0].extra, { pattern: '^\\d{5}$' });
  assert.equal(rows[1].kind, 'advanced');
  assert.equal(rows[2].kind, 'advanced');
  assert.deepEqual(writeParams(rows, rest), schema);
});

test('rows can be edited and the schema follows', () => {
  const { rows, rest } = readParams({ type: 'object', properties: {} });
  rows.push({ name: 'color', kind: 'choice', description: 'Favourite colour', choices: ['red', 'blue', ''], required: true, extra: {} });
  rows.push({ name: 'age', kind: 'number', description: '', choices: [], required: false, extra: {} });
  assert.deepEqual(writeParams(rows, rest), { type: 'object', properties: { color: { type: 'string', description: 'Favourite colour', enum: ['red', 'blue'] }, age: { type: 'number' } }, required: ['color'] });
  assert.deepEqual(writeParams([], {}), { type: 'object', properties: {} });
  assert.equal(readParams(undefined).rows.length, 0);
  assert.equal(readParams({ type: 'array' }).canEdit, false);
  assert.equal(readParams('nope').canEdit, false);
  assert.equal(PARAM_KINDS.length, 5);
});

test('problems with the rows are named, and a missing description is only a hint', () => {
  const found = problems([
    { name: '', kind: 'string', description: 'x', choices: [], required: false, extra: {} },
    { name: 'Bad Name', kind: 'string', description: 'x', choices: [], required: false, extra: {} },
    { name: 'ok', kind: 'string', description: '', choices: [], required: false, extra: {} },
    { name: 'ok', kind: 'string', description: 'dup', choices: [], required: false, extra: {} },
    { name: 'pick', kind: 'choice', description: 'x', choices: [], required: false, extra: {} },
  ]);
  assert.deepEqual(found.map((f) => [f.index, f.level || 'error']), [[0, 'error'], [1, 'error'], [2, 'hint'], [3, 'error'], [4, 'error']]);
});

test('"what the model sees" for the parameters, and a body built from them', () => {
  const { rows } = readParams({ type: 'object', properties: { city: { type: 'string', description: 'City' }, units: { type: 'string', enum: ['c', 'f'] } }, required: ['city'] });
  const view = modelView({ name: 'get_weather', description: 'Look up the weather.', rows });
  assert.equal(view.signature, 'get_weather(city, units)');
  assert.deepEqual(view.params, ['city (text, required): City', 'units (one of: c, f, optional)']);
  assert.deepEqual(bodyFromParams(rows), { city: '{{args.city}}', units: '{{args.units}}' });
});

// ---- tool facts ---------------------------------------------------------------------------------------------------------------------
test('which kinds the runtime can’t run yet', () => {
  assert.equal(notAvailable({ type: 'mcp' }), 'MCP server tools');
  assert.equal(notAvailable({ type: 'task' }), 'Task tools');
  assert.equal(notAvailable({ type: 'knowledge' }), 'Knowledge search tools');
  assert.equal(notAvailable({ type: 'code' }), 'Custom code tools');
  assert.equal(notAvailable({ type: 'builtin', builtin: 'send_dtmf' }), 'Send keypad tones');
  assert.equal(notAvailable({ type: 'builtin', builtin: 'end_call' }), null);
  assert.equal(notAvailable({ type: 'http' }), null);
  assert.equal(kindOfTool({ builtin: 'end_call' }), 'builtin');
  assert.ok(Object.keys(BUILTIN_HELP).length === 7);
});

test('which agents use a tool, and which tools nobody uses', () => {
  const config = example();
  assert.ok(agentsUsingTool(config, 'verify_caller').includes('billing'));
  assert.deepEqual(agentsUsingTool(config, 'no_such_tool'), []);
  const unused = unusedTools({ tools: [{ id: 'a' }, { id: 'b' }], agents: { items: [{ id: 'x', tools: ['a'] }] } });
  assert.deepEqual(unused, ['b']);
  assert.deepEqual(unusedTools({}), []);
});

test('advice on timeouts, retries and descriptions', () => {
  assert.match(timeoutAdvice({})[0], /default of 10 s/);
  assert.deepEqual(timeoutAdvice({ timeout_s: 6, retries: 1 }), []);
  assert.match(timeoutAdvice({ timeout_s: 20, retries: 3 }).join(' '), /20 s[\s\S]*retry/);
  assert.equal(describeAdvice('').level, 'warn');
  assert.equal(describeAdvice('Gets the bill').level, 'warn');
  assert.equal(describeAdvice('Fetches the current bill for the account number').level, 'hint');
  assert.equal(describeAdvice('Use when the caller asks what they owe, to fetch their current bill.').level, 'ok');
});
