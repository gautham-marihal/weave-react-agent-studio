import test from 'node:test';
import assert from 'node:assert/strict';
import { syntaxErrorLine } from '../src/studio/jsonPath.js';

// Settings › Edit as JSON says where a syntax error is: the line the browser names, else the line of the position it names.
test('a syntax error is put on its line', () => {
  const text = '{\n  "a": 1\n  "b": 2\n}';
  let message = '';
  try {
    JSON.parse(text);
  } catch (e) {
    message = e.message;
  }
  assert.equal(syntaxErrorLine(message, text), 3, message);
  // the two ways browsers say it
  assert.equal(syntaxErrorLine("Expected ',' or '}' after property value in JSON at position 11 (line 3 column 3)", text), 3);
  assert.equal(syntaxErrorLine('Unexpected string in JSON at position 11', text), 3);
  assert.equal(syntaxErrorLine('Unexpected end of JSON input', text), null);
  assert.equal(syntaxErrorLine(undefined, text), null);
});

// The code editor marks each problem on the characters it is about (json/jsonProblems.ts).
test('the editor marks a syntax error on the word the browser points at', async () => {
  const { jsonProblems, syntaxErrorOffset, errorLinesOf } = await import('../src/studio/json/jsonProblems.ts');
  const text = '{\n  "a": 1\n  "b": 2\n}';
  let message = '';
  try {
    JSON.parse(text);
  } catch (e) {
    message = e.message;
  }
  assert.equal(syntaxErrorOffset(message, text), 13, message);
  assert.equal(syntaxErrorOffset("Expected ',' or '}' after property value in JSON at position 13 (line 3 column 3)", text), 13);
  assert.equal(syntaxErrorOffset('Unexpected string in JSON at position 11', text), 11);
  assert.equal(syntaxErrorOffset('Unexpected end of JSON input', text), null);
  const [problem, ...more] = jsonProblems(text, { error: message }, null);
  assert.equal(more.length, 0);
  assert.equal(text.slice(problem.from, problem.to), '"b"', 'the whole key, not one character');
  assert.equal(problem.severity, 'error');
  assert.equal(problem.message, message);
  assert.deepEqual([...errorLinesOf(text, [problem])], [3]);
});

test('a key written twice is marked at both places, with the sentence the studio already says', async () => {
  const { jsonProblems } = await import('../src/studio/json/jsonProblems.ts');
  const { findDuplicateKeys } = await import('../src/studio/jsonDuplicates.js');
  const text = '{\n  "name": "A",\n  "name": "B"\n}';
  const duplicates = findDuplicateKeys(text);
  const problems = jsonProblems(text, { error: 'The key appears twice', duplicates }, null);
  assert.deepEqual(
    problems.map((p) => text.slice(p.from, p.to)),
    ['"name"', '"name"'],
  );
  assert.deepEqual(
    problems.map((p) => text.slice(0, p.from).split('\n').length),
    [2, 3],
  );
  assert.match(problems[0].message, /The key “name” appears twice in the top level, on lines 2 and 3/);
});

test('what the checks say is marked at the setting it names, errors and warnings, on its first line', async () => {
  const { jsonProblems } = await import('../src/studio/json/jsonProblems.ts');
  const text = JSON.stringify({ meta: { name: 'A' }, tools: [{ id: 't', kind: 'http' }] }, null, 2);
  const report = {
    errors: [
      { path: ['tools', 0, 'kind'], message: 'Unknown kind' },
      { path: [], message: 'not about a place' },
    ],
    warnings: [{ path: ['tools', 0], message: 'No description' }],
  };
  const problems = jsonProblems(text, {}, report);
  assert.deepEqual(
    problems.map((p) => [p.severity, text.slice(p.from, p.to), p.message]),
    [
      ['error', '"http"', 'Unknown kind'],
      ['warning', '{', 'No description'],
    ],
  );
  assert.deepEqual(jsonProblems(text, {}, null), []);
});
