import { describe, expect, it } from 'vitest';
import {
  detectPathStyle,
  isAbsoluteForeign,
  relativeIfUnder,
  pathsEqual,
  toPortableRelativePath,
} from '../../src/utils/paths';

describe('detectPathStyle', () => {
  it('detects Windows drive-letter paths', () => {
    expect(detectPathStyle('C:\\Users\\alice\\project')).toBe('win32');
    expect(detectPathStyle('D:/Work/my-api')).toBe('win32');
  });

  it('detects Windows UNC paths', () => {
    expect(detectPathStyle('\\\\server\\share\\folder')).toBe('win32');
  });

  it('detects POSIX absolute paths', () => {
    expect(detectPathStyle('/Users/alice/project')).toBe('posix');
    expect(detectPathStyle('/home/alice/project')).toBe('posix');
  });
});

describe('isAbsoluteForeign', () => {
  it('validates windows-style absolute paths regardless of host OS', () => {
    expect(isAbsoluteForeign('C:\\Users\\alice', 'win32')).toBe(true);
    expect(isAbsoluteForeign('relative\\path', 'win32')).toBe(false);
  });

  it('validates posix-style absolute paths regardless of host OS', () => {
    expect(isAbsoluteForeign('/home/alice', 'posix')).toBe(true);
    expect(isAbsoluteForeign('relative/path', 'posix')).toBe(false);
  });
});

describe('relativeIfUnder', () => {
  it('returns the relative posix path when candidate is under ancestor (posix)', () => {
    expect(relativeIfUnder('/Users/alice/dev/my-api/src', '/Users/alice/dev/my-api', 'posix')).toBe(
      'src',
    );
  });

  it('returns undefined for unrelated posix paths', () => {
    expect(relativeIfUnder('/Users/bob/dev/other', '/Users/alice/dev/my-api', 'posix')).toBeUndefined();
  });

  it('is case-insensitive for windows ancestors', () => {
    expect(relativeIfUnder('C:\\Work\\My-Api\\src', 'c:\\work\\my-api', 'win32')).toBe('src');
  });

  it('returns empty string relative path when candidate equals ancestor', () => {
    expect(relativeIfUnder('/Users/alice/dev/my-api', '/Users/alice/dev/my-api', 'posix')).toBe('');
  });
});

describe('pathsEqual', () => {
  it('is case-sensitive on posix', () => {
    expect(pathsEqual('/Users/alice', '/users/alice', 'posix')).toBe(false);
  });

  it('is case-insensitive on windows', () => {
    expect(pathsEqual('C:\\Users\\Alice', 'c:\\users\\alice', 'win32')).toBe(true);
  });
});

describe('toPortableRelativePath', () => {
  it('normalizes native separators to forward slashes', () => {
    // path.sep on the current platform; on posix this is already a no-op.
    expect(toPortableRelativePath('a/b/c')).toBe('a/b/c');
  });
});
