import { describe, expect, it } from 'vitest';
import { holdStagedPanel, stagedPanel, whenPanelKept, type Ask } from './stagedPanel';

// A side panel of the Agent page with changes not yet put in (no Done pressed): what would replace it asks first.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a panel with changes waiting', () => {
  it('with no panel waiting, what was asked for happens at once', () => {
    let ran = 0;
    whenPanelKept(() => (ran += 1), () => Promise.resolve(true));
    expect(ran).toBe(1);
  });

  it('is asked about: Keep puts them in and goes on, Stay leaves it as it was', async () => {
    let answer = false;
    let asked = '';
    const ask: Ask = (q) => {
      asked = q.title;
      return Promise.resolve(answer);
    };
    let done = 0;
    let refocused = 0;
    let ran = 0;
    const release = holdStagedPanel({ title: 'Voice', done: () => (done += 1), refocus: () => (refocused += 1) });
    expect(stagedPanel()?.title).toBe('Voice');

    whenPanelKept(() => (ran += 1), ask);
    await settle();
    expect(asked).toBe('Keep your changes to “Voice”?');
    expect([done, ran, refocused]).toEqual([0, 0, 1]);
    expect(stagedPanel()).not.toBeNull();

    answer = true;
    whenPanelKept(() => (ran += 1), ask);
    await settle();
    expect([done, ran]).toEqual([1, 1]);
    expect(stagedPanel()).toBeNull();
    release();
  });

  it('a panel that is put in or closed stops being asked about', () => {
    const release = holdStagedPanel({ title: 'Language', done: () => undefined });
    release();
    expect(stagedPanel()).toBeNull();
    let ran = 0;
    whenPanelKept(() => (ran += 1), () => Promise.resolve(false));
    expect(ran).toBe(1);
  });
});
