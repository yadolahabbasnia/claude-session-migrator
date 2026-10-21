import * as vscode from 'vscode';
import * as path from 'node:path';
import { scanSessionProjects, readSessionPreview } from '../discovery/sessionScanner';
import { getClaudeHomeDir, getSessionsRootDir } from '../utils/claudeHome';
import { syncRuntime } from '../utils/syncRuntime';
import { buildSyncPanelData } from './syncPanelData';
import { renderSessionsViewHtml } from './sessionsViewHtml';
import { detectSessionBackupCandidates } from '../discovery/backupDetector';
import { operationStatus } from './operationStatus';
import { confirmAndDelete } from './sessionDeleteWizard';
import { logger } from '../utils/logging';
import type { DiscoveredSessionProject } from '../models/session';

interface SerializedSessionProject {
  id: string;
  label: string;
  folderName: string;
  folderPath: string;
  sourcePath?: string;
  sourceKnown: boolean;
  sessionCount: number;
  sizeLabel: string;
  gitRemote?: string;
  lastModified: string;
  hasMemoryDir: boolean;
  sessions: Array<{ fileName: string; sizeLabel: string; messageCount: number; preview?: string; lastModified: string }>;
}

const TOOL_COMMANDS: Record<string, string> = {
  undoImport: 'claudeMigrator.undoImport',
  inspect: 'claudeMigrator.inspect',
  deleteSessions: 'claudeMigrator.deleteSessions',
  exportProjects: 'claudeMigrator.export',
  importBackup: 'claudeMigrator.import',
  scan: 'claudeMigrator.scan',
  validate: 'claudeMigrator.validate',
};

export class SessionsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'claudeMigrator.sessionsView';

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {
    this.disposables.push(
      operationStatus.onDidChangeStatus((event) => {
        this.post({ command: 'status', ...event });
      }),
      syncRuntime.onDidChange(() => {
        void this.postSyncPanel();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('claudeMigrator.gitSync')) {
          void this.postSyncPanel();
        }
      }),
    );
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = this.renderHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: { command: string; [k: string]: unknown }) => {
      try {
        await this.handleMessage(message);
      } catch (err) {
        logger.error('Sidebar message handling failed', { error: String(err) });
        this.post({ command: 'error', message: (err as Error).message });
      }
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  private async handleMessage(message: { command: string; [k: string]: unknown }): Promise<void> {
    switch (message.command) {
      case 'ready':
      case 'refresh':
        await this.refresh();
        return;
      case 'exportAll':
        await vscode.commands.executeCommand('claudeMigrator.exportSessions');
        return;
      case 'importSessions':
        await vscode.commands.executeCommand('claudeMigrator.importSessions');
        return;
      case 'exportProject':
        await vscode.commands.executeCommand('claudeMigrator.exportSessions', message.id as string);
        return;
      case 'syncGit':
        await vscode.commands.executeCommand('claudeMigrator.syncSessionsViaGit');
        void this.postSyncPanel();
        return;
      case 'configureGitRepo':
        await vscode.commands.executeCommand('claudeMigrator.configureGitSyncRepo');
        void this.postSyncPanel();
        return;
      case 'useLocalOnly':
        await vscode.commands.executeCommand('claudeMigrator.useLocalSessionsOnly');
        void this.postSyncPanel();
        return;
      case 'runTool': {
        // The webview can only trigger commands from this fixed list, never an arbitrary id.
        const commandId = TOOL_COMMANDS[message.tool as string];
        if (commandId) {
          await vscode.commands.executeCommand(commandId);
          await this.refresh();
        }
        return;
      }
      case 'toggleAutoSync': {
        const config = vscode.workspace.getConfiguration('claudeMigrator');
        await config.update('gitSync.autoSync', !config.get<boolean>('gitSync.autoSync', true), vscode.ConfigurationTarget.Global);
        void this.postSyncPanel();
        return;
      }
      case 'mergeBackups':
        await vscode.commands.executeCommand('claudeMigrator.mergeSessionBackups');
        await this.refresh();
        return;
      case 'reveal':
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(message.folderPath as string));
        return;
      case 'preview': {
        const filePath = path.join(message.folderPath as string, message.fileName as string);
        const turns = await readSessionPreview(filePath);
        this.post({ command: 'previewResult', title: message.fileName, turns });
        return;
      }
      case 'deleteProject': {
        const project = await this.findProject(message.id as string);
        if (!project) {
          return;
        }
        const outcome = await confirmAndDelete({
          request: { kind: 'project', folderName: project.folderName },
          title: `Delete all ${project.sessions.length} session(s) of ${labelFor(project)}?`,
          summaryLines: [project.folderPath],
          warning: project.hasMemoryDir
            ? 'This project has a memory/ directory. Deleting the project removes it too.'
            : undefined,
        });
        if (outcome) {
          await this.refresh();
        }
        return;
      }
      case 'deleteSessions': {
        const project = await this.findProject(message.id as string);
        if (!project) {
          return;
        }
        // Only accept names this project actually has right now -- the webview's list can be
        // stale, and a name it no longer owns must not be turned into a delete.
        const requested = new Set((message.fileNames as string[]) ?? []);
        const known = project.sessions.map((s) => s.fileName).filter((name) => requested.has(name));
        if (known.length === 0) {
          this.post({ command: 'status', message: 'Nothing to delete -- the list was out of date.' });
          await this.refresh();
          return;
        }
        const outcome = await confirmAndDelete({
          request: { kind: 'sessions', folderName: project.folderName, fileNames: known },
          title: `Delete ${known.length} session(s) from ${labelFor(project)}?`,
          summaryLines: known.map((name) => {
            const session = project.sessions.find((s) => s.fileName === name);
            return session?.firstUserMessagePreview ?? name;
          }),
        });
        if (outcome) {
          await this.refresh();
        }
        return;
      }
    }
  }

  /** Re-reads the sessions on disk and finds the project by id, so a delete never acts on the
   * webview's possibly-stale view of what exists. */
  private async findProject(id: string): Promise<DiscoveredSessionProject | undefined> {
    const projects = await scanSessionProjects(getSessionsRootDir(getClaudeHomeDir()));
    const project = projects.find((p) => p.id === id);
    if (!project) {
      this.post({ command: 'status', message: 'That project no longer exists. Refreshing...' });
      await this.refresh();
    }
    return project;
  }

  private async refresh(): Promise<void> {
    const sessionsRoot = getSessionsRootDir(getClaudeHomeDir());
    this.post({ command: 'status', message: 'Scanning sessions...' });
    const projects = await scanSessionProjects(sessionsRoot);

    // Pre-import safety backups (`<project>.backup-<timestamp>`, see migrationEngine.ts) are not
    // separate projects -- they're redundant duplicates of a live folder sitting right next to
    // them. Hiding them from the main list (instead of listing them as if they were their own
    // project) keeps the list honest; "Merge Session Backups" is how you get them back/clear them.
    const backupCandidates = detectSessionBackupCandidates(sessionsRoot, projects.map((p) => p.folderName));
    const mergeableNames = new Set(backupCandidates.map((c) => c.backupFolderName));
    const visibleProjects = projects.filter((p) => !mergeableNames.has(p.folderName));

    this.post({
      command: 'projects',
      data: visibleProjects.map(serialize),
      sessionsRoot,
      stats: {
        projects: visibleProjects.length,
        sessions: visibleProjects.reduce((n, p) => n + p.sessions.length, 0),
        bytes: visibleProjects.reduce((n, p) => n + p.totalSizeBytes, 0),
        lastActive: visibleProjects.map((p) => p.lastModified).sort().pop(),
      },
    });
    this.post({
      command: 'status',
      message: `Found ${visibleProjects.length} session project(s).`,
      done: true,
    });
    this.post({ command: 'backupCandidates', count: backupCandidates.length });
    void this.postSyncPanel();
  }

  private async postSyncPanel(): Promise<void> {
    if (!this.view) {
      return;
    }
    try {
      this.post({ command: 'syncPanel', data: await buildSyncPanelData() });
    } catch (err) {
      logger.warn('Could not build sync panel data', { error: String(err) });
    }
  }

  private post(message: Record<string, unknown>): void {
    this.view?.webview.postMessage(message);
  }

  private renderHtml(webview: vscode.Webview): string {
    return renderSessionsViewHtml(getNonce(), webview.cspSource);
  }
}

function serialize(project: DiscoveredSessionProject): SerializedSessionProject {
  return {
    id: project.id,
    label: project.sourcePath ? path.basename(project.sourcePath) : project.folderName,
    folderName: project.folderName,
    folderPath: project.folderPath,
    sourcePath: project.sourcePath,
    sourceKnown: !!project.sourcePath,
    sessionCount: project.sessions.length,
    sizeLabel: formatBytes(project.totalSizeBytes),
    gitRemote: project.git?.remoteUrls[0],
    lastModified: project.lastModified,
    hasMemoryDir: project.hasMemoryDir,
    sessions: project.sessions.map((s) => ({
      fileName: s.fileName,
      sizeLabel: formatBytes(s.sizeBytes),
      messageCount: s.messageCount,
      preview: s.firstUserMessagePreview,
      lastModified: s.lastModified,
    })),
  };
}

function labelFor(project: DiscoveredSessionProject): string {
  return project.sourcePath ? path.basename(project.sourcePath) : project.folderName;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
