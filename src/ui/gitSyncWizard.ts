import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  getGitSyncArchiveFileName,
  getGitSyncBranch,
  getGitSyncLocalPath,
  getGitSyncRepoUrl,
  setGitSyncSetting,
} from '../utils/config';
import { commitAndPush, ensureRepoAtPath, isGitInstalled, pull, GitSyncError } from '../utils/gitSync';
import { pathExists } from '../utils/filesystem';
import { getMachineInfo } from '../utils/platform';
import { runSessionExportWizard } from './sessionExportWizard';
import { runSessionImportWizard } from './sessionImportWizard';
import { withCancellableProgress } from './progress';
import { logger } from '../utils/logging';
import { OperationCancelledError } from '../utils/errors';

interface GitSyncSettings {
  repoUrl: string;
  localPath: string;
  branch: string;
  archiveFileName: string;
}

/**
 * Lets the user push their local Claude Code sessions to a dedicated git repository, or pull
 * sessions someone else (or another one of their own machines) pushed there -- an alternative
 * to manually copying `.cmt` archives around. Before touching anything, it verifies the
 * configured local folder is actually a checkout of the configured repository (see
 * `ensureRepoAtPath`), so a stale or mistaken local path can never silently push into, or pull
 * sessions from, the wrong place.
 */
export async function runGitSyncWizard(): Promise<void> {
  try {
    if (!(await isGitInstalled())) {
      vscode.window.showErrorMessage(
        'Claude Migrator: git was not found on PATH. Install git to sync sessions via a git repository.',
      );
      return;
    }

    const settings = await resolveSettings();
    if (!settings) {
      return;
    }

    await withCancellableProgress('Preparing git sync repository...', async () => {
      await ensureRepoAtPath(settings.localPath, settings.repoUrl, settings.branch);
      await pull(settings.localPath, settings.branch);
    });

    const pushLabel = '$(cloud-upload) Push -- export my sessions to the repo';
    const pullLabel = '$(cloud-download) Pull -- import sessions from the repo';
    const choice = await vscode.window.showQuickPick([pushLabel, pullLabel], {
      title: `Sync Claude Code sessions via git (${settings.repoUrl})`,
      ignoreFocusOut: true,
    });
    if (!choice) {
      return;
    }

    const archivePath = path.join(settings.localPath, settings.archiveFileName);

    if (choice === pushLabel) {
      const exported = await runSessionExportWizard(undefined, archivePath);
      if (!exported) {
        return;
      }
      const machine = getMachineInfo();
      const pushed = await withCancellableProgress('Pushing sessions to git repository...', async () => {
        return commitAndPush(
          settings.localPath,
          settings.branch,
          `Update Claude sessions from ${machine.hostname} (${new Date().toISOString()})`,
        );
      });
      vscode.window.showInformationMessage(
        pushed
          ? `Claude Migrator: sessions pushed to ${settings.repoUrl}.`
          : 'Claude Migrator: nothing changed -- the repository already had these sessions.',
      );
      return;
    }

    if (!(await pathExists(archivePath))) {
      vscode.window.showInformationMessage(
        `Claude Migrator: no session archive (${settings.archiveFileName}) was found in ${settings.repoUrl} yet -- ` +
          'push from another machine first.',
      );
      return;
    }
    await runSessionImportWizard(vscode.Uri.file(archivePath));
  } catch (err) {
    if (err instanceof OperationCancelledError) {
      return;
    }
    logger.error('Git sync failed', { error: String(err) });
    const message = err instanceof GitSyncError ? err.message : `Unexpected error -- ${(err as Error).message}`;
    vscode.window.showErrorMessage(`Claude Migrator: git sync failed. ${message}`, { modal: true });
  }
}

async function resolveSettings(): Promise<GitSyncSettings | undefined> {
  let repoUrl = getGitSyncRepoUrl();
  if (!repoUrl) {
    repoUrl = (
      await vscode.window.showInputBox({
        title: 'Claude Migrator: Sync Sessions via Git',
        prompt: 'Git repository URL to sync Claude Code sessions through (e.g. git@github.com:you/claude-sessions.git)',
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim() ? undefined : 'A repository URL is required.'),
      })
    )?.trim() ?? '';
    if (!repoUrl) {
      return undefined;
    }
    await setGitSyncSetting('repoUrl', repoUrl);
  }

  let localPath = getGitSyncLocalPath();
  if (!localPath) {
    const defaultUri = vscode.Uri.file(path.join(os.homedir(), '.claude-session-sync'));
    const picked = await vscode.window.showOpenDialog({
      title: 'Select (or create) the local folder to check the sync repository out into',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri,
      openLabel: 'Use this folder',
    });
    localPath = picked?.[0]?.fsPath ?? '';
    if (!localPath) {
      return undefined;
    }
    await setGitSyncSetting('localPath', localPath);
  }

  return {
    repoUrl,
    localPath,
    branch: getGitSyncBranch(),
    archiveFileName: getGitSyncArchiveFileName(),
  };
}
