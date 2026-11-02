import { describe, expect, it } from 'vitest';
import { canSave, initialSave, isDirty, saveLabel, saveReducer, type SaveEvent, type SaveMachine } from './saveState';

const run = (events: SaveEvent[], start: SaveMachine = initialSave('{"a":1}')) => events.reduce(saveReducer, start);

describe('save state: explicit Save', () => {
  it('starts idle and saved', () => {
    const m = initialSave('{"a":1}');
    expect(m.state).toBe('idle');
    expect(isDirty(m)).toBe(false);
    expect(saveLabel(m)).toBe('Saved');
    expect(canSave(m)).toBe(false);
  });

  it('idle -> dirty on an edit; editing back to what was saved is not dirty', () => {
    const dirty = run([{ type: 'edited', json: '{"a":2}' }]);
    expect(dirty.state).toBe('dirty');
    expect(saveLabel(dirty)).toBe('Unsaved changes');
    expect(canSave(dirty)).toBe(true);
    const back = saveReducer(dirty, { type: 'edited', json: '{"a":1}' });
    expect(back.state).toBe('idle');
    expect(canSave(back)).toBe(false);
  });

  it('dirty -> saving -> saved', () => {
    const saving = run([{ type: 'edited', json: '{"a":2}' }, { type: 'save_started' }]);
    expect(saving.state).toBe('saving');
    expect(saveLabel(saving)).toBe('Saving…');
    expect(canSave(saving)).toBe(false);
    const saved = saveReducer(saving, { type: 'save_succeeded', savedJson: '{"a":2}' });
    expect(saved.state).toBe('saved');
    expect(isDirty(saved)).toBe(false);
    expect(saveLabel(saved)).toBe('Saved');
  });

  it('edits made while saving stay unsaved after the save', () => {
    const m = run([{ type: 'edited', json: '{"a":2}' }, { type: 'save_started' }, { type: 'edited', json: '{"a":3}' }]);
    expect(m.state).toBe('saving');
    const after = saveReducer(m, { type: 'save_succeeded', savedJson: '{"a":2}' });
    expect(after.state).toBe('dirty');
    expect(canSave(after)).toBe(true);
  });

  it('saving -> conflict keeps the edits and stays a conflict while typing', () => {
    const m = run([{ type: 'edited', json: '{"a":2}' }, { type: 'save_started' }, { type: 'save_conflicted' }]);
    expect(m.state).toBe('conflict');
    expect(m.currentJson).toBe('{"a":2}');
    expect(saveReducer(m, { type: 'edited', json: '{"a":4}' }).state).toBe('conflict');
    expect(canSave(m)).toBe(true);
  });

  it('saving -> error says why and keeps the edits; Save can be pressed again', () => {
    const m = run([{ type: 'edited', json: '{"a":2}' }, { type: 'save_started' }, { type: 'save_failed', message: 'The Agent Builder API is not responding.' }]);
    expect(m.state).toBe('error');
    expect(m.error).toBe('The Agent Builder API is not responding.');
    expect(saveLabel(m)).toBe('Could not save');
    expect(isDirty(m)).toBe(true);
    expect(canSave(m)).toBe(true);
    expect(saveReducer(m, { type: 'save_started' }).error).toBeNull();
  });

  it('cannot save while the JSON view’s text does not parse, or when the person may not edit', () => {
    const dirty = run([{ type: 'edited', json: '{"a":2}' }]);
    expect(canSave(dirty, { parseError: 'Unexpected token' })).toBe(false);
    expect(canSave(dirty, { canEdit: false })).toBe(false);
  });

  it('discarding goes back to what the server has', () => {
    const m = run([{ type: 'edited', json: '{"a":2}' }, { type: 'discarded' }]);
    expect(m.state).toBe('idle');
    expect(m.currentJson).toBe('{"a":1}');
  });

  it('loading the server’s draft (Load theirs, a publish) starts clean', () => {
    const m = run([{ type: 'edited', json: '{"a":2}' }, { type: 'save_started' }, { type: 'save_conflicted' }, { type: 'loaded', json: '{"a":9}' }]);
    expect(m).toEqual(initialSave('{"a":9}'));
  });

  it('after a save, more edits make it dirty, and undoing them is saved again', () => {
    const saved = run([{ type: 'edited', json: '{"a":2}' }, { type: 'save_started' }, { type: 'save_succeeded', savedJson: '{"a":2}' }]);
    const dirty = saveReducer(saved, { type: 'edited', json: '{"a":3}' });
    expect(dirty.state).toBe('dirty');
    expect(saveReducer(dirty, { type: 'edited', json: '{"a":2}' }).state).toBe('saved');
  });
});
