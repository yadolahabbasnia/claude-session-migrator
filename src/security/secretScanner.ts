/**
 * Lightweight, best-effort secret scanner. This is intentionally not an enterprise-grade
 * detector -- its purpose is to catch obvious accidental exports (API keys, tokens, private
 * keys) before they leave the machine, and warn rather than claim perfect coverage.
 */

export interface SecretRule {
  id: string;
  description: string;
  pattern: RegExp;
}

export interface SecretFinding {
  /** Path relative to the .claude directory. */
  file: string;
  line: number;
  ruleId: string;
  description: string;
  /** A short, redacted preview -- never the full secret value. */
  preview: string;
}

export const SECRET_RULES: SecretRule[] = [
  {
    id: 'aws-access-key-id',
    description: 'AWS Access Key ID',
    pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    id: 'aws-secret-key',
    description: 'Possible AWS Secret Access Key',
    pattern: /aws_secret_access_key\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi,
  },
  {
    id: 'anthropic-api-key',
    description: 'Anthropic API key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: 'openai-api-key',
    description: 'OpenAI API key',
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: 'github-token',
    description: 'GitHub personal access / app token',
    pattern: /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    id: 'slack-token',
    description: 'Slack token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    id: 'generic-bearer-token',
    description: 'Bearer token',
    pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g,
  },
  {
    id: 'private-key-block',
    description: 'Private key block',
    pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  },
  {
    id: 'generic-api-key-assignment',
    description: 'Generic API key / secret assignment',
    pattern:
      /\b((?:api|secret|access|client)[-_]?(?:key|token|secret)|password)\s*[:=]\s*['"]([A-Za-z0-9_\-/+=]{16,})['"]/gi,
  },
];

export function scanTextForSecrets(relativeFilePath: string, content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split(/\r\n|\r|\n/);

  lines.forEach((lineText, index) => {
    for (const rule of SECRET_RULES) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(lineText)) !== null) {
        const matchedValue = match[match.length - 1] ?? match[0];
        findings.push({
          file: relativeFilePath,
          line: index + 1,
          ruleId: rule.id,
          description: rule.description,
          preview: redact(matchedValue),
        });
        if (!rule.pattern.global) {
          break;
        }
      }
    }
  });

  return findings;
}

function redact(value: string): string {
  if (value.length <= 8) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(value.length - 8, 20))}${value.slice(-4)}`;
}

/**
 * Scans and rewrites `content` in a single pass, replacing every matched secret span with a
 * `[REDACTED:<ruleId>]` placeholder. Returns the redacted content alongside the findings (with
 * their usual redacted previews) -- the raw secret value never leaves this function.
 */
export function redactSecrets(
  relativeFilePath: string,
  content: string,
): { content: string; findings: SecretFinding[] } {
  const findings: SecretFinding[] = [];
  const lines = content.split(/\r\n|\r|\n/);

  const redactedLines = lines.map((lineText, index) => {
    let result = lineText;
    for (const rule of SECRET_RULES) {
      rule.pattern.lastIndex = 0;
      result = result.replace(rule.pattern, (fullMatch, ...groups) => {
        const capturedGroups = groups.slice(0, -2) as string[];
        const matchedValue = capturedGroups[capturedGroups.length - 1] ?? fullMatch;
        findings.push({
          file: relativeFilePath,
          line: index + 1,
          ruleId: rule.id,
          description: rule.description,
          preview: redact(matchedValue),
        });
        return fullMatch.replace(matchedValue, `[REDACTED:${rule.id}]`);
      });
    }
    return result;
  });

  return { content: redactedLines.join('\n'), findings };
}
