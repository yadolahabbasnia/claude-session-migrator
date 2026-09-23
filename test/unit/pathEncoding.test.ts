import { describe, expect, it } from 'vitest';
import { encodeProjectPath } from '../../src/discovery/pathEncoding';

describe('encodeProjectPath', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    expect(encodeProjectPath('/home/alice/dev/my-api')).toBe('-home-alice-dev-my-api');
  });

  it('encodes a Windows path the same way (colon, backslash, dot all become dashes)', () => {
    expect(encodeProjectPath('C:\\Users\\alice\\dev\\my.api')).toBe('C--Users-alice-dev-my-api');
  });

  it('produces the same output for equivalent inputs regardless of separator style read', () => {
    // Not claiming reversibility -- just checking the transform is a pure, deterministic function.
    const a = encodeProjectPath('/Users/alice/Developer/my-api');
    const b = encodeProjectPath('/Users/alice/Developer/my-api');
    expect(a).toBe(b);
  });

  it('keeps short paths intact (no truncation/hash needed)', () => {
    const encoded = encodeProjectPath('/home/alice/dev/my-api');
    expect(encoded).toBe('-home-alice-dev-my-api');
    expect(encoded.length).toBeLessThanOrEqual(200);
  });

  it('truncates and appends a hash suffix for paths whose encoded form exceeds 200 characters', () => {
    const longPath = '/home/alice/' + 'a'.repeat(250);
    const encoded = encodeProjectPath(longPath);
    expect(encoded.length).toBeLessThan(longPath.length);
    expect(encoded.startsWith('-home-alice-' + 'a'.repeat(188))).toBe(true);
    expect(encoded).toMatch(/-[0-9a-z]+$/);
  });

  it('is deterministic for the same long path (same hash suffix every time)', () => {
    const longPath = '/home/alice/' + 'b'.repeat(250);
    expect(encodeProjectPath(longPath)).toBe(encodeProjectPath(longPath));
  });

  it('produces different hash suffixes for different long paths with the same 200-char prefix', () => {
    const base = '/home/alice/' + 'c'.repeat(200);
    const pathA = base + '/one';
    const pathB = base + '/two';
    expect(encodeProjectPath(pathA)).not.toBe(encodeProjectPath(pathB));
  });
});
