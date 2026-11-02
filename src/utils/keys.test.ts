import { describe, expect, it } from 'vitest';
import { isMacPlatform, isTypingTarget, modKey, redoLabel, shortcutLabel } from './keys';

describe('key labels', () => {
  it('reads a Mac, iPhone or iPad from the platform, and nothing else', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
    expect(isMacPlatform('macOS')).toBe(true);
    expect(isMacPlatform('iPhone')).toBe(true);
    expect(isMacPlatform('Win32')).toBe(false);
    expect(isMacPlatform('Linux x86_64')).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });

  it('names the shortcut as it reads on that keyboard', () => {
    expect(modKey(true)).toBe('⌘');
    expect(modKey(false)).toBe('Ctrl');
    expect(shortcutLabel('K', true)).toBe('⌘ K');
    expect(shortcutLabel('S', false)).toBe('Ctrl S');
    expect(redoLabel(true)).toBe('⌘ ⇧ Z');
    expect(redoLabel(false)).toBe('Ctrl Y');
  });

  it('knows when a key press is typing: a field, a text box, a list or editable text', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
