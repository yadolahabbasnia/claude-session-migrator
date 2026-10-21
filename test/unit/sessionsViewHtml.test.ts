import { describe, expect, it } from 'vitest';
import { renderSessionsViewHtml } from '../../src/ui/sessionsViewHtml';

describe('renderSessionsViewHtml', () => {
  const html = renderSessionsViewHtml('nonce123', 'vscode-resource:');

  it('embeds a script that parses as valid JavaScript', () => {
    const match = /<script nonce="nonce123">([\s\S]*)<\/script>/.exec(html);
    expect(match).not.toBeNull();
    expect(() => new Function('acquireVsCodeApi', 'document', 'window', match![1])).not.toThrow();
  });

  it('never uses inline style attributes, which the CSP blocks', () => {
    expect(html).not.toMatch(/\sstyle="/);
  });

  it('locks scripts and styles to the nonce and leaves no unresolved template placeholders', () => {
    expect(html).toContain("script-src 'nonce-nonce123'");
    expect(html).toContain("style-src 'nonce-nonce123'");
    expect(html).not.toContain('${');
  });

  it('only builds DOM from disk-derived text via textContent, never innerHTML assignment', () => {
    expect(html).not.toMatch(/\.innerHTML\s*=/);
  });
});
