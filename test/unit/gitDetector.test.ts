import { describe, expect, it } from 'vitest';
import { normalizeRemoteUrl } from '../../src/discovery/gitDetector';

describe('normalizeRemoteUrl', () => {
  it('normalizes ssh and https forms of the same repo to the same value', () => {
    const ssh = normalizeRemoteUrl('git@github.com:acme/my-api.git');
    const https = normalizeRemoteUrl('https://github.com/acme/my-api.git');
    expect(ssh).toBe(https);
  });

  it('is case-insensitive', () => {
    expect(normalizeRemoteUrl('https://github.com/Acme/My-Api.git')).toBe(
      normalizeRemoteUrl('https://github.com/acme/my-api.git'),
    );
  });

  it('ignores a trailing slash', () => {
    expect(normalizeRemoteUrl('https://github.com/acme/my-api/')).toBe(
      normalizeRemoteUrl('https://github.com/acme/my-api'),
    );
  });

  it('distinguishes genuinely different repos', () => {
    expect(normalizeRemoteUrl('https://github.com/acme/my-api.git')).not.toBe(
      normalizeRemoteUrl('https://github.com/acme/other-api.git'),
    );
  });
});
