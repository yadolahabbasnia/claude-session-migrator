import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { walkFiles, looksBinary } from '../utils/filesystem';
import { scanTextForSecrets, redactSecrets, type SecretFinding } from '../security/secretScanner';
import { toPortableRelativePath } from '../utils/paths';

/** Anything the security-review step can scan: a project's `.claude` dir, or a Claude Code
 * session project's folder under `<claudeHome>/projects/`. */
export interface SecurityScanTarget {
  id: string;
  label: string;
  rootPath: string;
}

export interface SecurityReviewResult {
  excludedByTarget: Map<string, Set<string>>;
  placeholderByTarget: Map<string, Map<string, string>>;
  findingsCount: number;
}

/**
 * Scans every text file under each target for obvious secrets and, for every flagged file,
 * asks the user to exclude it, replace the detected secrets with placeholders, or include it
 * anyway. Shared by both the project-config and session export wizards.
 */
export async function runSecurityReview(targets: SecurityScanTarget[]): Promise<SecurityReviewResult> {
  const excludedByTarget = new Map<string, Set<string>>();
  const placeholderByTarget = new Map<string, Map<string, string>>();
  let findingsCount = 0;

  for (const target of targets) {
    const fileFindings = new Map<string, SecretFinding[]>();
    for await (const file of walkFiles(target.rootPath)) {
      const buffer = await fs.readFile(file.absolutePath);
      if (looksBinary(buffer)) {
        continue;
      }
      const relative = toPortableRelativePath(file.relativePath);
      const findings = scanTextForSecrets(relative, buffer.toString('utf8'));
      if (findings.length > 0) {
        fileFindings.set(relative, findings);
      }
    }

    if (fileFindings.size === 0) {
      continue;
    }
    findingsCount += [...fileFindings.values()].reduce((sum, f) => sum + f.length, 0);

    const excluded = new Set<string>();
    const placeholders = new Map<string, string>();

    for (const [relative, findings] of fileFindings) {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(circle-slash) Exclude this file from the export', action: 'exclude' as const },
          { label: '$(replace) Replace secrets with placeholders', action: 'placeholder' as const },
          { label: '$(check) Include anyway', action: 'include' as const },
        ],
        {
          title: `Potential secret detected: ${target.label}/${relative}`,
          placeHolder: findings.map((f) => `line ${f.line}: ${f.description} (${f.preview})`).join('; '),
          ignoreFocusOut: true,
        },
      );
      if (!choice || choice.action === 'exclude') {
        excluded.add(relative);
      } else if (choice.action === 'placeholder') {
        const absolutePath = path.join(target.rootPath, ...relative.split('/'));
        const content = await fs.readFile(absolutePath, 'utf8');
        const redacted = redactSecrets(relative, content);
        placeholders.set(relative, redacted.content);
      }
    }

    if (excluded.size > 0) {
      excludedByTarget.set(target.id, excluded);
    }
    if (placeholders.size > 0) {
      placeholderByTarget.set(target.id, placeholders);
    }
  }

  return { excludedByTarget, placeholderByTarget, findingsCount };
}

export async function pickArchiveDestinationFile(defaultBaseName: string): Promise<string | undefined> {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const defaultUri = vscode.Uri.file(path.join(os.homedir(), `${defaultBaseName}-${dateStamp}.cmt`));
  const uri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { 'Claude Migration Transfer': ['cmt'] },
    title: 'Export to...',
  });
  return uri?.fsPath;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
