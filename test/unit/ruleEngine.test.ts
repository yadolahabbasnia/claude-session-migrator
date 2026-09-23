import { describe, expect, it } from 'vitest';
import { transformFileContent } from '../../src/migration/ruleEngine';
import type { PathContext } from '../../src/migration/pathResolver';

const source: PathContext = {
  projectRoot: '/Users/alice/dev/my-api',
  homeDir: '/Users/alice',
  workspaceRoot: '/Users/alice/dev/my-api',
  style: 'posix',
};

const dest: PathContext = {
  projectRoot: 'D:\\Work\\my-api',
  homeDir: 'C:\\Users\\bob',
  workspaceRoot: 'D:\\Work\\my-api',
  style: 'win32',
};

describe('transformFileContent', () => {
  it('replaces the source project path with the destination path', () => {
    const content = 'root: /Users/alice/dev/my-api/src';
    const result = transformFileContent('notes.txt', content, source, dest);
    expect(result.content).toBe('root: D:\\Work\\my-api\\src');
    expect(result.replacements).toBe(1);
  });

  it('preserves paths relative to the project root as relative segments', () => {
    const content = 'file: /Users/alice/dev/my-api/src/deep/nested/file.ts';
    const result = transformFileContent('notes.txt', content, source, dest);
    expect(result.content).toContain('D:\\Work\\my-api\\src\\deep\\nested\\file.ts');
  });

  it('does not modify unrelated text', () => {
    const content = 'This file has no machine-specific paths at all, just prose.';
    const result = transformFileContent('notes.txt', content, source, dest);
    expect(result.content).toBe(content);
    expect(result.replacements).toBe(0);
  });

  it('leaves unrelated absolute paths untouched and reports them as unresolved', () => {
    const content = 'see /opt/homebrew/bin/node for the binary';
    const result = transformFileContent('notes.txt', content, source, dest);
    expect(result.content).toBe(content);
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].originalPath).toBe('/opt/homebrew/bin/node');
  });

  it('transforms JSON while keeping the result valid JSON', () => {
    const content = JSON.stringify({ cwd: '/Users/alice/dev/my-api/data' });
    const result = transformFileContent('settings.json', content, source, dest);
    const parsed = JSON.parse(result.content);
    expect(parsed.cwd).toBe('D:\\Work\\my-api\\data');
    expect(result.replacements).toBe(1);
  });

  it('JSON-escapes backslashes when splicing a Windows destination path into JSON', () => {
    // Naively splicing "D:\Work\my-api" into JSON text would produce an invalid \W escape
    // sequence; the transform must escape backslashes so the result stays valid JSON.
    const content = '{"path": "/Users/alice/dev/my-api"}';
    const result = transformFileContent('settings.json', content, source, dest);
    expect(() => JSON.parse(result.content)).not.toThrow();
    expect(JSON.parse(result.content).path).toBe('D:\\Work\\my-api');
    expect(result.jsonValidationFailed).toBe(false);
  });
});

describe('transformFileContent on .jsonl (session transcripts)', () => {
  it('transforms the cwd field on every independent line', () => {
    const content = [
      JSON.stringify({ type: 'user', cwd: '/Users/alice/dev/my-api', sessionId: 's1' }),
      JSON.stringify({ type: 'assistant', text: 'no path here' }),
      JSON.stringify({ type: 'user', cwd: '/Users/alice/dev/my-api/sub', sessionId: 's1' }),
    ].join('\n');

    const result = transformFileContent('session.jsonl', content, source, dest);
    const lines = result.content.split('\n').map((l) => JSON.parse(l));
    expect(lines[0].cwd).toBe('D:\\Work\\my-api');
    expect(lines[1].text).toBe('no path here');
    expect(lines[2].cwd).toBe('D:\\Work\\my-api\\sub');
    expect(result.replacements).toBe(2);
  });

  it('every resulting line is still independently valid JSON', () => {
    const content = [
      JSON.stringify({ cwd: '/Users/alice/dev/my-api' }),
      JSON.stringify({ note: 'unrelated /opt/tool/bin reference' }),
    ].join('\n');

    const result = transformFileContent('session.jsonl', content, source, dest);
    for (const line of result.content.split('\n')) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('reverts only the offending line when a replacement would corrupt that line, keeping the rest', () => {
    // A line intentionally malformed *before* any replacement -- transforming it should still
    // leave it as its original (already-broken) text rather than throwing or discarding other
    // lines' valid transforms.
    const goodLine = JSON.stringify({ cwd: '/Users/alice/dev/my-api' });
    const malformedLine = '{"cwd": "/Users/alice/dev/my-api", not-json}';
    const content = [goodLine, malformedLine].join('\n');

    const result = transformFileContent('session.jsonl', content, source, dest);
    const outLines = result.content.split('\n');
    expect(JSON.parse(outLines[0]).cwd).toBe('D:\\Work\\my-api');
    expect(outLines[1]).toBe(malformedLine);
    expect(result.jsonValidationFailed).toBe(true);
  });

  it('leaves an unresolved reference with an index relative to the whole file, not just its line', () => {
    const content = ['{"note":"first line, no paths"}', '{"note":"see /opt/tool/bin"}'].join('\n');
    const result = transformFileContent('session.jsonl', content, source, dest);
    expect(result.unresolved).toHaveLength(1);
    const unresolvedIndex = result.unresolved[0].index;
    expect(content.slice(unresolvedIndex, unresolvedIndex + '/opt/tool/bin'.length)).toBe(
      '/opt/tool/bin',
    );
  });
});
