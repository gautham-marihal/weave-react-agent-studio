import test from 'node:test';
import assert from 'node:assert/strict';
import { ICON_NAMES, PATHS } from '../src/ui/iconPaths.js';

// One icon set. Every shape is well-formed, so no icon renders as nothing, and the ones the studio's navigation and journey need all exist.
test('every icon is made of well-formed path data or circles', () => {
  assert.ok(ICON_NAMES.length >= 20);
  ICON_NAMES.forEach((name) => {
    assert.ok(PATHS[name].length > 0, `${name} has shapes`);
    PATHS[name].forEach((part) => {
      if (part.startsWith('circle:')) assert.match(part, /^circle:-?[\d.]+ -?[\d.]+ [\d.]+$/, `${name}: ${part}`);
      else {
        assert.match(part, /^M-?[\d.]/, `${name}: a path starts with a move (${part})`);
        assert.match(part, /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/, `${name}: only path commands and numbers (${part})`);
      }
    });
  });
});

test('the icons the navigation, the journey and the cards use all exist', () => {
  ['home', 'agent', 'phone', 'voice', 'plug', 'dial', 'sliders', 'search', 'help', 'build', 'test', 'release', 'monitor', 'check', 'alert', 'info', 'close', 'chevronDown', 'chevronRight', 'arrowRight', 'menu', 'records', 'pencil', 'tools', 'sound', 'globe', 'team']
    .forEach((name) => assert.ok(ICON_NAMES.includes(name), name));
});
