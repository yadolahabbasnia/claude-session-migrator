import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  resolveDeletionTargets,
  deleteSessionTargets,
  type Remover,
  type SessionDeletionRequest,
  type DeletionOutcome,
} from '../migration/sessionDeleter';
import { scanSessionProjects } from '../discovery/sessionScanner';
import { getClaudeHomeDir, getSessionsRootDir } from '../utils/claudeHome';
import { logger } from '../utils/logging';
import { OperationCancelledError } from '../utils/errors';
import type { DiscoveredSessionProject } from '../models/session';

/**
 * Sessions are the user's own conversation history and there is no export step in front of this
 * flow, so deletion goes to the OS trash by default -- recoverable outside the editor. Some
 * environments (remote containers, certain Linux setups without a freedesktop trash) cannot
 * trash; there we fall back to a permanent delete, but only after saying so in the prompt, so
 * "permanently" is never a surprise.
 */
export const trashRemover: Remover = async (absolutePath, options) => {
  await vscode.workspace.fs.delete(vscode.Uri.file(absolutePath), {
    recursive: options.recursive,
    useTrash: true,
  });
};

export const permanentVscodeRemover: Remover = async (absolutePath, options) => {
  await vscode.workspace.fs.delete(vscode.Uri.file(absolutePath), {
    recursive: options.recursive,
    useTrash: false,
  });
};

export interface DeleteFlowRequest {
  request: SessionDeletionRequest;
  /** Lines shown in the confirmation prompt describing exactly what goes away. */
  summaryLines: string[];
  /** Headline for the modal, e.g. 'Delete 3 session(s)?'. */
  title: string;
  /** Extra warning appended to the prompt, e.g. that a memory directory is included. */
  warning?: string;
}

/**
 * Shared confirm-then-delete path used by both the sidebar buttons and the command palette.
 * Returns the outcome, or undefined when the user cancelled.
 */
export async function confirmAndDelete(
  flow: DeleteFlowRequest,
): Promise<DeletionOutcome | undefined> {
  const sessionsRoot = getSessionsRootDir(getClaudeHomeDir());
  const targets = resolveDeletionTargets(sessionsRoot, flow.request);
  if (targets.length === 0) {
    return undefined;
  }

  const MAX_LISTED = 15;
  const listed = flow.summaryLines.slice(0, MAX_LISTED);
  const remainder = flow.summaryLines.length - listed.length;
  const detail = [
    ...listed,
    ...(remainder > 0 ? [`...and ${remainder} more`] : []),
    '',
    'They will be moved to the system trash where possible.',
    ...(flow.warning ? ['', flow.warning] : []),
  ].join('\n');

  const confirmLabel = 'Delete';
  const confirmed = await vscode.window.showWarningMessage(flow.title, { modal: true, detail }, confirmLabel);
  if (confirmed !== confirmLabel) {
    return undefined;
  }

  let usedPermanentFallback = false;
  const remover: Remover = async (absolutePath, options) => {
    try {
      await trashRemover(absolutePath, options);
    } catch (err) {
      logger.warn('Trash delete failed, falling back to permanent delete', {
        path: absolutePath,
        error: String(err),
      });
      usedPermanentFallback = true;
      await permanentVscodeRemover(absolutePath, options);
    }
  };

  const outcome = await deleteSessionTargets(targets, { remove: remover, pruneEmptyFolders: true });
  reportOutcome(outcome, usedPermanentFallback);
  return outcome;
}

function reportOutcome(outcome: DeletionOutcome, usedPermanentFallback: boolean): void {
  const parts: string[] = [];
  const projects = outcome.deleted.filter((t) => t.kind === 'project').length;
  const sessions = outcome.deleted.filter((t) => t.kind === 'session').length;
  if (projects > 0) {
    parts.push(`${projects} project folder(s)`);
  }
  if (sessions > 0) {
    parts.push(`${sessions} session(s)`);
  }
  if (outcome.prunedFolders.length > 0) {
    parts.push(`${outcome.prunedFolders.length} now-empty folder(s)`);
  }

  const deletedText = parts.length > 0 ? `Deleted ${parts.join(', ')}.` : 'Nothing was deleted.';
  const trashNote = usedPermanentFallback ? ' Some items could not be trashed and were deleted permanently.' : '';

  if (outcome.failures.length === 0) {
    vscode.window.showInformationMessage(`Claude Migrator: ${deletedText}${trashNote}`);
    return;
  }
  const failureText = outcome.failures.map((f) => `${f.target.label}: ${f.message}`).join('\n');
  vscode.window.showWarningMessage(
    `Claude Migrator: ${deletedText}${trashNote} ${outcome.failures.length} failed.`,
    { modal: true, detail: failureText },
  );
}

/** Command-palette entry point: pick a project, then delete all of it or pick sessions within it. */
export async function runSessionDeleteWizard(): Promise<void> {
  try {
    const sessionsRoot = getSessionsRootDir(getClaudeHomeDir());
    const projects = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Claude Migrator: scanning sessions...' },
      () => scanSessionProjects(sessionsRoot),
    );
    if (projects.length === 0) {
      vscode.window.showInformationMessage(`Claude Migrator: no sessions found under ${sessionsRoot}.`);
      return;
    }

    const project = await pickProject(projects);
    if (!project) {
      return;
    }

    const scope = await vscode.window.showQuickPick(
      [
        {
          label: '$(list-selection) Pick sessions to delete',
          detail: `Choose one or more of this project's ${project.sessions.length} session(s).`,
          value: 'sessions' as const,
        },
        {
          label: '$(trash) Delete the whole project',
          detail: project.hasMemoryDir
            ? 'Removes every session AND this project’s memory directory.'
            : 'Removes every session in this project.',
          value: 'project' as const,
        },
      ],
      { title: `Delete from ${projectLabel(project)}`, ignoreFocusOut: true },
    );
    if (!scope) {
      return;
    }

    if (scope.value === 'project') {
      await confirmAndDelete({
        request: { kind: 'project', folderName: project.folderName },
        title: `Delete all ${project.sessions.length} session(s) of ${projectLabel(project)}?`,
        summaryLines: [project.folderPath],
        warning: project.hasMemoryDir
          ? 'This project has a memory/ directory. Deleting the project removes it too.'
          : undefined,
      });
      return;
    }

    const picked = await vscode.window.showQuickPick(
      project.sessions.map((s) => ({
        label: `$(comment-discussion) ${s.firstUserMessagePreview || s.fileName}`,
        description: `${s.messageCount} msgs`,
        detail: s.fileName,
        fileName: s.fileName,
      })),
      { title: `Sessions in ${projectLabel(project)}`, canPickMany: true, ignoreFocusOut: true },
    );
    if (!picked || picked.length === 0) {
      return;
    }

    await confirmAndDelete({
      request: { kind: 'sessions', folderName: project.folderName, fileNames: picked.map((p) => p.fileName) },
      title: `Delete ${picked.length} session(s) from ${projectLabel(project)}?`,
      summaryLines: picked.map((p) => p.label.replace(/^\$\([^)]+\)\s*/, '')),
    });
  } catch (err) {
    if (err instanceof OperationCancelledError) {
      return;
    }
    logger.error('Session delete failed', { error: String(err) });
    vscode.window.showErrorMessage(`Claude Migrator: delete failed -- ${(err as Error).message}`);
  }
}

async function pickProject(
  projects: DiscoveredSessionProject[],
): Promise<DiscoveredSessionProject | undefined> {
  const picked = await vscode.window.showQuickPick(
    projects.map((p) => ({
      label: `$(folder) ${projectLabel(p)}`,
      description: `${p.sessions.length} session(s)`,
      detail: p.sourcePath ?? `unknown source (folder: ${p.folderName})`,
      project: p,
    })),
    { title: 'Delete Claude Code sessions -- pick a project', ignoreFocusOut: true },
  );
  return picked?.project;
}

function projectLabel(project: DiscoveredSessionProject): string {
  return project.sourcePath ? path.basename(project.sourcePath) : project.folderName;
}
