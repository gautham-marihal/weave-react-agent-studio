import { describe, expect, it } from 'vitest';
import { firstNameOf, identifierKey, initialsOf, nameFromIdentifier, profileProblems, readProfiles } from './profile';

describe('the signed-in person, in words', () => {
  it('makes a name from an email until the person gives theirs', () => {
    expect(nameFromIdentifier('asha.rao@harbour.example')).toBe('Asha rao');
    expect(nameFromIdentifier('  sam@x.com ')).toBe('Sam');
    expect(nameFromIdentifier('+4420')).toBe('+4420');
    expect(nameFromIdentifier('')).toBe('You');
  });

  it('greets by the first name and draws two initials', () => {
    expect(firstNameOf('Asha Rao')).toBe('Asha');
    expect(firstNameOf('  Kim ')).toBe('Kim');
    expect(initialsOf('Asha Rao')).toBe('AR');
    expect(initialsOf('kim')).toBe('KI');
    expect(initialsOf('')).toBe('YO');
  });

  it('matches an email however it was typed', () => {
    expect(identifierKey(' Asha@Harbour.Example ')).toBe('asha@harbour.example');
  });

  it('asks for a name and a workspace name, not too long', () => {
    expect(profileProblems({ name: '', workspaceName: '' })).toEqual({ name: 'Enter your name.', workspaceName: 'Enter a name for your workspace.' });
    expect(profileProblems({ name: 'Asha', workspaceName: 'Harbour' })).toEqual({});
    expect(profileProblems({ name: 'A'.repeat(81), workspaceName: 'W'.repeat(61) })).toEqual({
      name: 'Use 80 characters or fewer.',
      workspaceName: 'Use 60 characters or fewer.',
    });
  });

  it('reads remembered profiles, skipping anything that is not one', () => {
    expect(readProfiles(null)).toEqual({});
    expect(readProfiles('not json')).toEqual({});
    expect(readProfiles('[1]')).toEqual({});
    expect(readProfiles(JSON.stringify({ 'a@x.com': { name: 'Asha', workspaceName: 'Harbour' }, 'b@x.com': { name: '' }, c: 3 }))).toEqual({
      'a@x.com': { name: 'Asha', workspaceName: 'Harbour' },
    });
  });
});
