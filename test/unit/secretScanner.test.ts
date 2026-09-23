import { describe, expect, it } from 'vitest';
import { scanTextForSecrets, redactSecrets } from '../../src/security/secretScanner';

describe('scanTextForSecrets', () => {
  it('detects an AWS access key id', () => {
    const findings = scanTextForSecrets('settings.json', 'key = AKIAABCDEFGHIJKLMNOP');
    expect(findings.some((f) => f.ruleId === 'aws-access-key-id')).toBe(true);
  });

  it('detects an Anthropic API key', () => {
    const findings = scanTextForSecrets(
      'settings.json',
      'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwx',
    );
    expect(findings.some((f) => f.ruleId === 'anthropic-api-key')).toBe(true);
  });

  it('detects a private key block', () => {
    const findings = scanTextForSecrets('id_rsa', '-----BEGIN RSA PRIVATE KEY-----\nMIIByyy\n-----END');
    expect(findings.some((f) => f.ruleId === 'private-key-block')).toBe(true);
  });

  it('reports the correct line number', () => {
    const content = 'line one\nline two\nAKIAABCDEFGHIJKLMNOP\nline four';
    const findings = scanTextForSecrets('f.txt', content);
    expect(findings[0].line).toBe(3);
  });

  it('never includes the full secret value in the preview', () => {
    const secret = 'AKIAABCDEFGHIJKLMNOP';
    const findings = scanTextForSecrets('f.txt', secret);
    expect(findings[0].preview).not.toBe(secret);
    expect(findings[0].preview).toContain('*');
  });

  it('does not flag ordinary text', () => {
    const findings = scanTextForSecrets('f.txt', 'This is a normal sentence about configuration.');
    expect(findings).toHaveLength(0);
  });
});

describe('redactSecrets', () => {
  it('replaces the secret with a placeholder and preserves surrounding text', () => {
    const { content, findings } = redactSecrets('f.txt', 'token=AKIAABCDEFGHIJKLMNOP end');
    expect(content).toContain('[REDACTED:aws-access-key-id]');
    expect(content).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(content.startsWith('token=')).toBe(true);
    expect(content.endsWith('end')).toBe(true);
    expect(findings).toHaveLength(1);
  });
});
