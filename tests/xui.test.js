import test from 'node:test';
import assert from 'node:assert/strict';
import { groupKeys, looksLikePhone, looksLikeUrl, orderKeys, readXui, splitAdvanced } from '../src/studio/form/xui.js';

test('only well-formed hints are read', () => {
  assert.deepEqual(readXui({ 'x-ui': { widget: 'jsonpath', label: ' Path ', help: 'h', group: 'Source', order: 2, advanced: true } }), {
    widget: 'jsonpath',
    label: 'Path',
    help: 'h',
    example: undefined,
    audience: undefined,
    group: 'Source',
    order: 2,
    advanced: true,
  });
  assert.deepEqual(readXui({ 'x-ui': { widget: 'sparkles', label: '', order: 'x', advanced: 'yes' } }), {
    widget: undefined,
    label: undefined,
    help: undefined,
    example: undefined,
    audience: undefined,
    group: undefined,
    order: undefined,
    advanced: false,
  });
  assert.equal(readXui({}).widget, undefined);
  assert.equal(readXui(undefined).advanced, false);
});

test('order: lowest first, ties and unordered keep the schema order', () => {
  const hints = { a: {}, b: { order: 2 }, c: { order: 1 }, d: {}, e: { order: 2 } };
  assert.deepEqual(
    orderKeys(['a', 'b', 'c', 'd', 'e'], (k) => hints[k]),
    ['c', 'b', 'e', 'a', 'd'],
  );
  assert.deepEqual(
    orderKeys(['x', 'y'], () => ({})),
    ['x', 'y'],
  );
});

test('groups keep their keys together where the group first appears', () => {
  const hints = { a: {}, b: { group: 'Source' }, c: {}, d: { group: 'Source' }, e: { group: 'Timing' } };
  assert.deepEqual(
    groupKeys(['a', 'b', 'c', 'd', 'e'], (k) => hints[k]),
    [
      { group: '', keys: ['a', 'c'] },
      { group: 'Source', keys: ['b', 'd'] },
      { group: 'Timing', keys: ['e'] },
    ],
  );
});

test('advanced keys are split off', () => {
  const hints = { a: {}, b: { advanced: true }, c: {} };
  assert.deepEqual(
    splitAdvanced(['a', 'b', 'c'], (k) => hints[k]),
    { main: ['a', 'c'], advanced: ['b'] },
  );
});

test('phone and url shapes', () => {
  assert.equal(looksLikePhone('+1 (415) 555-0100'), true);
  assert.equal(looksLikePhone('call me'), false);
  assert.equal(looksLikePhone('123'), false);
  assert.equal(looksLikeUrl('https://api.example.com/x'), true);
  assert.equal(looksLikeUrl('example.com'), false);
  assert.equal(looksLikeUrl('ftp://x'), false);
});

test('the example and the audience hints are read, and a made-up audience is ignored', () => {
  assert.equal(readXui({ 'x-ui': { example: ' 8 ', audience: 'expert' } }).example, '8');
  assert.equal(readXui({ 'x-ui': { audience: 'expert' } }).audience, 'expert');
  assert.equal(readXui({ 'x-ui': { audience: 'wizard' } }).audience, undefined);
});
