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
