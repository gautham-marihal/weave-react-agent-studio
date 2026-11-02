import { describe, expect, it } from 'vitest';
import { compareVersions, nextVersion, publishOptions } from './releaseVersion';

describe('version numbers for publishing', () => {
  it('compares numbers, not text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
  });

  it('counts the next number for each bump', () => {
    expect([nextVersion('1.2.3', 'patch'), nextVersion('1.2.3', 'minor'), nextVersion('1.2.3', 'major')]).toEqual(['1.2.4', '1.3.0', '2.0.0']);
  });

  it('a draft that equals the patch bump appears once, not twice', () => {
    const { options, defaultChoice } = publishOptions('1.0.0', '1.0.1');
    expect(options.map((o) => [o.value, o.version])).toEqual([
      ['patch', '1.0.1'],
      ['minor', '1.1.0'],
      ['major', '2.0.0'],
    ]);
    expect(options[0].matchesDraft).toBe(true);
    expect(defaultChoice).toBe('patch');
  });

  it('a draft number of its own is offered first and chosen by default', () => {
    const { options, defaultChoice } = publishOptions('1.0.0', '1.5.0');
    expect([options[0].value, options[0].disabled, defaultChoice]).toEqual(['draft', false, 'draft']);
  });

  it('a draft that is not newer than the latest is switched off', () => {
    for (const draft of ['1.0.0', '0.9.0']) {
      const { options, defaultChoice } = publishOptions('1.0.0', draft);
      expect([options[0].value, options[0].disabled, defaultChoice]).toEqual(['draft', true, 'patch']);
      expect(options[0].hint).toMatch(/Not newer than 1\.0\.0/);
    }
  });

  it('an invalid draft version is switched off too', () => {
    expect(publishOptions('1.0.0', undefined).options[0].disabled).toBe(true);
    expect(publishOptions('1.0.0', 'one').options[0].version).toBe('—');
  });

  it('first publish offers just the draft version', () => {
    const { options, defaultChoice } = publishOptions(null, '0.1.0');
    expect(options.map((o) => o.value)).toEqual(['draft']);
    expect([options[0].version, defaultChoice]).toEqual(['0.1.0', 'draft']);
  });
});
