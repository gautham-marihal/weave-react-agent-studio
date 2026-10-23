import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatWhen } from '../src/studio/format.js';
import { formatDuration, formatRelative } from '../src/pages/helpers.js';

// "When" and "how long" are written one way on every page (it was "3 h ago" on one page and "3 hr ago" on another, "4 d ago" beside "4 days ago",
// "0 sec" beside "10 s").
const NOW = Date.parse('2026-10-22T12:00:00Z');
const ago = (s) => new Date(NOW - s * 1000).toISOString();

test('when: just now, minutes, hours, days, then the date', () => {
  assert.equal(formatWhen(ago(10), { nowMs: NOW }), 'just now');
  assert.equal(formatWhen(ago(5 * 60), { nowMs: NOW }), '5 min ago');
  assert.equal(formatWhen(ago(3600), { nowMs: NOW }), '1 hour ago');
  assert.equal(formatWhen(ago(3 * 3600), { nowMs: NOW }), '3 hours ago');
  assert.equal(formatWhen(ago(86400), { nowMs: NOW }), '1 day ago');
  assert.equal(formatWhen(ago(4 * 86400), { nowMs: NOW }), '4 days ago');
  // a month and more: the date, in the person's own way of writing one ("Sep 7", "7 Sept"), without the year when it is this year's
  const older = formatWhen(ago(45 * 86400), { nowMs: NOW });
  assert.match(older, /(^|\D)7(\D|$)/);
  assert.doesNotMatch(older, /ago|2026/);
  assert.match(formatWhen('2025-03-02T10:00:00Z', { nowMs: NOW }), /2025/, 'another year: with the year');
  assert.equal(formatWhen(''), '');
  assert.equal(formatWhen('not a date'), '');
});

test('when, at the start of a line: the same words, capitalised, and the date after a week', () => {
  assert.equal(formatRelative(new Date(Date.now() - 10 * 1000).toISOString()), 'Just now');
  assert.equal(formatRelative(new Date(Date.now() - 3 * 3600 * 1000).toISOString()), '3 hours ago');
  assert.equal(formatRelative(new Date(Date.now() - 2 * 86400 * 1000).toISOString()), '2 days ago');
  assert.doesNotMatch(formatRelative(new Date(Date.now() - 10 * 86400 * 1000).toISOString()), /ago/);
  assert.equal(formatRelative(''), '—');
});

test('how long: seconds, minutes and seconds, hours and minutes, in short units', () => {
  assert.equal(formatDuration(0), '0 s');
  assert.equal(formatDuration(10), '10 s');
  assert.equal(formatDuration(68), '1 min 8 s');
  assert.equal(formatDuration(120), '2 min');
  assert.equal(formatDuration(3900), '1 h 5 min');
});
