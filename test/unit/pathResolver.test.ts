import { describe, expect, it } from 'vitest';
import {
  toPortablePath,
  resolvePortablePath,
  classifyPortablePath,
  findAbsolutePaths,
  type PathContext,
} from '../../src/migration/pathResolver';

const macSource: PathContext = {
  projectRoot: '/Users/alice/Developer/my-api',
  homeDir: '/Users/alice',
  workspaceRoot: '/Users/alice/Developer/my-api',
  style: 'posix',
};

const linuxSource: PathContext = {
  projectRoot: '/home/alice/dev/my-api',
  homeDir: '/home/alice',
  workspaceRoot: '/home/alice/dev/my-api',
  style: 'posix',
};

const windowsSource: PathContext = {
  projectRoot: 'C:\\Users\\alice\\dev\\my-api',
  homeDir: 'C:\\Users\\alice',
  workspaceRoot: 'C:\\Users\\alice\\dev\\my-api',
  style: 'win32',
};

const windowsDest: PathContext = {
  projectRoot: 'D:\\Work\\my-api',
  homeDir: 'C:\\Users\\bob',
  workspaceRoot: 'D:\\Work\\my-api',
  style: 'win32',
};

const macDest: PathContext = {
  projectRoot: '/Users/bob/Developer/my-api',
  homeDir: '/Users/bob',
  workspaceRoot: '/Users/bob/Developer/my-api',
  style: 'posix',
};

const linuxDest: PathContext = {
  projectRoot: '/home/bob/dev/my-api',
  homeDir: '/home/bob',
  workspaceRoot: '/home/bob/dev/my-api',
  style: 'posix',
};

describe('toPortablePath', () => {
  it('tokenizes a path under the project root', () => {
    expect(toPortablePath('/Users/alice/Developer/my-api/src/index.ts', macSource)).toBe(
      '$PROJECT_ROOT/src/index.ts',
    );
  });

  it('tokenizes a path under the home directory but outside the project', () => {
    expect(toPortablePath('/Users/alice/notes.md', macSource)).toBe('$HOME/notes.md');
  });

  it('prefers the most specific root (project root over home)', () => {
    expect(toPortablePath(macSource.projectRoot, macSource)).toBe('$PROJECT_ROOT');
  });

  it('returns undefined for unrelated paths', () => {
    expect(toPortablePath('/Users/bob/other-project/file.ts', macSource)).toBeUndefined();
  });

  it('tokenizes windows-style paths under the project root', () => {
    expect(toPortablePath('C:\\Users\\alice\\dev\\my-api\\src\\index.ts', windowsSource)).toBe(
      '$PROJECT_ROOT/src/index.ts',
    );
  });
});

describe('cross-platform migration matrix', () => {
  const matrix: Array<{ name: string; source: PathContext; dest: PathContext; sourcePath: string }> = [
    { name: 'windows -> windows', source: windowsSource, dest: windowsDest, sourcePath: 'C:\\Users\\alice\\dev\\my-api\\src\\a.ts' },
    { name: 'windows -> macOS', source: windowsSource, dest: macDest, sourcePath: 'C:\\Users\\alice\\dev\\my-api\\src\\a.ts' },
    { name: 'windows -> linux', source: windowsSource, dest: linuxDest, sourcePath: 'C:\\Users\\alice\\dev\\my-api\\src\\a.ts' },
    { name: 'macOS -> windows', source: macSource, dest: windowsDest, sourcePath: '/Users/alice/Developer/my-api/src/a.ts' },
    { name: 'macOS -> linux', source: macSource, dest: linuxDest, sourcePath: '/Users/alice/Developer/my-api/src/a.ts' },
    { name: 'linux -> windows', source: linuxSource, dest: windowsDest, sourcePath: '/home/alice/dev/my-api/src/a.ts' },
    { name: 'linux -> macOS', source: linuxSource, dest: macDest, sourcePath: '/home/alice/dev/my-api/src/a.ts' },
  ];

  for (const { name, source, dest, sourcePath } of matrix) {
    it(`resolves a project-root-relative path (${name})`, () => {
      const portable = toPortablePath(sourcePath, source);
      expect(portable).toBe('$PROJECT_ROOT/src/a.ts');
      const resolved = resolvePortablePath(portable!, dest);
      const expectedSeparator = dest.style === 'win32' ? '\\' : '/';
      expect(resolved).toBe(`${dest.projectRoot}${expectedSeparator}src${expectedSeparator}a.ts`);
    });
  }
});

describe('classifyPortablePath', () => {
  it('classifies project-relative paths', () => {
    expect(classifyPortablePath('/Users/alice/Developer/my-api/src', macSource)).toBe('project-root');
  });

  it('classifies home-relative paths', () => {
    expect(classifyPortablePath('/Users/alice/notes.md', macSource)).toBe('home');
  });

  it('classifies unrelated absolute paths', () => {
    expect(classifyPortablePath('/opt/homebrew/bin/node', macSource)).toBe('absolute-unclassified');
  });
});

describe('findAbsolutePaths', () => {
  it('finds posix absolute paths in text', () => {
    const matches = findAbsolutePaths('working dir is /Users/alice/dev/my-api and that is it');
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('/Users/alice/dev/my-api');
    expect(matches[0].style).toBe('posix');
  });

  it('finds windows absolute paths in text', () => {
    const matches = findAbsolutePaths('path: C:\\Users\\alice\\dev\\my-api\\file.txt');
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toBe('C:\\Users\\alice\\dev\\my-api\\file.txt');
    expect(matches[0].style).toBe('win32');
  });

  it('does not treat URLs as absolute filesystem paths', () => {
    const matches = findAbsolutePaths('see https://example.com/docs/page for details');
    expect(matches).toHaveLength(0);
  });

  it('ignores plain relative paths', () => {
    const matches = findAbsolutePaths('run ./scripts/build.sh or src/index.ts');
    expect(matches).toHaveLength(0);
  });

  it('finds multiple distinct paths in the same text', () => {
    const matches = findAbsolutePaths('from /Users/alice/a to /Users/alice/b');
    expect(matches.map((m) => m.text)).toEqual(['/Users/alice/a', '/Users/alice/b']);
  });
});
