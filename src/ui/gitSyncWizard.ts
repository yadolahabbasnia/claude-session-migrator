import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  getGitSyncArchiveFileName,
  getGitSyncBranch,
  getGitSyncLocalPath,
  getGitSyncMode,
  getGitSyncRepoUrl,
  setGitSyncSetting,
} from '../utils/config';
import { commitAndPush, ensureRepoAtPath, isGitInstalled, pull, GitSyncError } from '../utils/gitSync';
import { pathExists } from '../utils/filesystem';
import { getMachineInfo } from '../utils/platform';
import { detectClaudeProfiles, getSessionsRootDir } from '../utils/claudeHome';
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

/** Last path segment of a remote URL, with `.git` stripped -- used to name an auto-created
 * sync-checkout subfolder so picking a general parent folder (e.g. "~/Code") doesn't collide
 * with whatever else already lives there. */
function deriveRepoFolderName(repoUrl: string): string {
  const cleaned = repoUrl.trim().replace(/\/+$/, '').replace(/\.git$/i, '');
  const segment = cleaned.split(/[/:]/).filter(Boolean).pop();
  return segment && /^[\w.-]+$/.test(segment) ? segment : 'claude-session-sync';
}

/**
 * Runs `ensureRepoAtPath` + `pull`, and if that fails because the configured local folder isn't
 * usable (wrong repo, or a non-empty folder that isn't a git checkout at all -- see
 * `ensureRepoAtPath`), offers to pick a different folder right there instead of just failing, so
 * one bad folder pick doesn't permanently wedge the saved settings.
 */
async function prepareRepoWithRecovery(settings: GitSyncSettings): Promise<GitSyncSettings | undefined> {
  let current = settings;
  for (;;) {
    try {
      await withCancellableProgress('Preparing git sync repository...', async () => {
        await ensureRepoAtPath(current.localPath, current.repoUrl, current.branch);
        await pull(current.localPath, current.branch);
      });
      return current;
    } catch (err) {
      if (err instanceof OperationCancelledError) {
        throw err;
      }
      const message = err instanceof GitSyncError ? err.message : `Unexpected error -- ${(err as Error).message}`;
      const retryLabel = 'Pick a Different Folder';
      const choice = await vscode.window.showErrorMessage(
        `Claude Migrator: git sync failed. ${message}`,
        { modal: true },
        retryLabel,
      );
      if (choice !== retryLabel) {
        return undefined;
      }
      const retried = await resolveSettings(true);
      if (!retried) {
        return undefined;
      }
      current = retried;
    }
  }
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

    const wasConfigured = !!getGitSyncRepoUrl() && !!getGitSyncLocalPath();
    const initialSettings = await resolveSettings(false);
    if (!initialSettings) {
      return;
    }

    const settings = await prepareRepoWithRecovery(initialSettings);
    if (!settings) {
      return;
    }

    if (!wasConfigured) {
      await setGitSyncSetting('mode', 'git');
      vscode.window.showInformationMessage(
        `Claude Migrator: ${settings.repoUrl} is now the sessions sync reference. Your local ` +
          "sessions under ~/.claude/projects are untouched -- run \"Claude Migrator: Use Local " +
          'Sessions Only" any time to stop treating this repo as the reference.',
      );
    }

    const sessionsRoot = await resolveSessionsRoot();
    if (!sessionsRoot) {
      return;
    }

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
      const exported = await runSessionExportWizard(undefined, archivePath, sessionsRoot);
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
    await runSessionImportWizard(vscode.Uri.file(archivePath), sessionsRoot);
  } catch (err) {
    if (err instanceof OperationCancelledError) {
      return;
    }
    logger.error('Git sync failed', { error: String(err) });
    const message = err instanceof GitSyncError ? err.message : `Unexpected error -- ${(err as Error).message}`;
    vscode.window.showErrorMessage(`Claude Migrator: git sync failed. ${message}`, { modal: true });
  }
}

/**
 * Lets the user change the configured repo URL and/or local checkout path at any time, not just
 * the first time -- it never touches `~/.claude/projects`, only where sync looks for the
 * archive, and re-validates the (possibly new) local path against the (possibly new) repo URL
 * before saving either.
 */
export async function runConfigureGitSyncRepo(): Promise<void> {
  try {
    if (!(await isGitInstalled())) {
      vscode.window.showErrorMessage(
        'Claude Migrator: git was not found on PATH. Install git to sync sessions via a git repository.',
      );
      return;
    }
    const initialSettings = await resolveSettings(true);
    if (!initialSettings) {
      return;
    }
    const settings = await prepareRepoWithRecovery(initialSettings);
    if (!settings) {
      return;
    }
    await setGitSyncSetting('mode', 'git');
    vscode.window.showInformationMessage(
      `Claude Migrator: git sync repository set to ${settings.repoUrl} (checked out at ${settings.localPath}). ` +
        'Local sessions were not touched.',
    );
  } catch (err) {
    if (err instanceof OperationCancelledError) {
      return;
    }
    logger.error('Git sync reconfiguration failed', { error: String(err) });
    const message = err instanceof GitSyncError ? err.message : `Unexpected error -- ${(err as Error).message}`;
    vscode.window.showErrorMessage(`Claude Migrator: could not switch git sync repository. ${message}`, {
      modal: true,
    });
  }
}

/**
 * Switches the sidebar/sync wizard back to treating plain local `~/.claude/projects` as the
 * reference, without deleting or moving anything -- the configured repo URL/local path are left
 * in place so "Sync Sessions via Git" can resume right where it left off later.
 */
export async function useLocalSessionsOnly(): Promise<void> {
  if (getGitSyncMode() === 'local') {
    vscode.window.showInformationMessage('Claude Migrator: already using local sessions only.');
    return;
  }
  await setGitSyncSetting('mode', 'local');
  vscode.window.showInformationMessage(
    'Claude Migrator: switched back to local sessions only. Nothing was deleted -- your git sync ' +
      'repository settings are kept, so you can resume with "Sync Sessions via Git" any time.',
  );
}

async function resolveSessionsRoot(): Promise<string | undefined> {
  const profiles = await detectClaudeProfiles();
  if (profiles.length <= 1) {
    return getSessionsRootDir(profiles[0]?.homeDir);
  }

  const picked = await vscode.window.showQuickPick(
    profiles.map((p) => ({
      label: `$(account) ${p.homeDir}`,
      description: p.isActive ? 'active in this window' : undefined,
      homeDir: p.homeDir,
    })),
    {
      title: 'Multiple Claude Code accounts/profiles were found on this machine -- which one do you want to sync?',
      ignoreFocusOut: true,
    },
  );
  return picked ? getSessionsRootDir(picked.homeDir) : undefined;
}

async function resolveSettings(forceReconfigure: boolean): Promise<GitSyncSettings | undefined> {
  let repoUrl = forceReconfigure ? '' : getGitSyncRepoUrl();
  if (!repoUrl) {
    repoUrl = (
      await vscode.window.showInputBox({
        title: 'Claude Migrator: Sync Sessions via Git',
        prompt: 'Git repository URL to sync Claude Code sessions through (e.g. git@github.com:you/claude-sessions.git)',
        value: getGitSyncRepoUrl(),
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim() ? undefined : 'A repository URL is required.'),
      })
    )?.trim() ?? '';
    if (!repoUrl) {
      return undefined;
    }
    await setGitSyncSetting('repoUrl', repoUrl);
  }

  let localPath = forceReconfigure ? '' : getGitSyncLocalPath();
  if (!localPath) {
    const defaultUri = vscode.Uri.file(getGitSyncLocalPath() || path.join(os.homedir(), '.claude-session-sync'));
    const picked = await vscode.window.showOpenDialog({
      title: 'Select a parent folder for the sync checkout (a subfolder will be created there, unless this is already the right checkout)',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri,
      openLabel: 'Use this folder',
    });
    const pickedPath = picked?.[0]?.fsPath;
    if (!pickedPath) {
      return undefined;
    }
    // If the picked folder is already a checkout (right or wrong repo -- ensureRepoAtPath sorts
    // that out next), use it as-is. Otherwise treat it as a parent dir and create a dedicated
    // subfolder, so pointing this at e.g. "~/Code" never collides with what's already there.
    localPath = (await pathExists(path.join(pickedPath, '.git')))
      ? pickedPath
      : path.join(pickedPath, deriveRepoFolderName(repoUrl));
    await setGitSyncSetting('localPath', localPath);
  }

  return {
    repoUrl,
    localPath,
    branch: getGitSyncBranch(),
    archiveFileName: getGitSyncArchiveFileName(),
  };
}
