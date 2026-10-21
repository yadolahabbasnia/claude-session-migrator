import {
  getGitSyncArchiveFileName,
  getGitSyncAutoSyncEnabled,
  getGitSyncBranch,
  getGitSyncLocalPath,
  getGitSyncMode,
  getGitSyncRepoUrl,
} from '../utils/config';
import { getRepoStatus, listSyncArchives, machineArchiveFileName, type RepoStatus } from '../utils/gitSync';
import { detectClaudeProfiles, getClaudeHomeDir } from '../utils/claudeHome';
import { getMachineInfo } from '../utils/platform';
import { isDirectory } from '../utils/filesystem';
import { syncRuntime, type SyncRuntimeState } from '../utils/syncRuntime';

export interface SyncArchiveView {
  fileName: string;
  sizeBytes: number;
  committedAt?: string;
  isOwn: boolean;
}

/** Everything the sidebar's sync card shows. Plain JSON so it can be posted to the webview. */
export interface SyncPanelData {
  mode: 'local' | 'git';
  autoSync: boolean;
  configured: boolean;
  repoUrl: string;
  branch: string;
  localPath: string;
  checkoutExists: boolean;
  hostname: string;
  claudeHome: string;
  profileCount: number;
  repo?: RepoStatus;
  archives: SyncArchiveView[];
  runtime: SyncRuntimeState;
}

export async function buildSyncPanelData(): Promise<SyncPanelData> {
  const repoUrl = getGitSyncRepoUrl();
  const localPath = getGitSyncLocalPath();
  const branch = getGitSyncBranch();
  const hostname = getMachineInfo().hostname;
  const ownFileName = machineArchiveFileName(getGitSyncArchiveFileName(), hostname);

  const checkoutExists = !!localPath && (await isDirectory(localPath));
  const repo = checkoutExists ? await getRepoStatus(localPath, branch).catch(() => undefined) : undefined;
  const archives: SyncArchiveView[] =
    checkoutExists && repo
      ? (await listSyncArchives(localPath).catch(() => [])).map((a) => ({
          fileName: a.fileName,
          sizeBytes: a.sizeBytes,
          committedAt: a.committedAt,
          isOwn: a.fileName === ownFileName,
        }))
      : [];
  const profiles = await detectClaudeProfiles().catch(() => []);

  return {
    mode: getGitSyncMode(),
    autoSync: getGitSyncAutoSyncEnabled(),
    configured: !!repoUrl && !!localPath,
    repoUrl,
    branch,
    localPath,
    checkoutExists,
    hostname,
    claudeHome: getClaudeHomeDir(),
    profileCount: profiles.length,
    repo,
    archives,
    runtime: syncRuntime.get(),
  };
}
