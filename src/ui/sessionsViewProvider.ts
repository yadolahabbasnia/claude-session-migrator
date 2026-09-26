import * as vscode from 'vscode';
import * as path from 'node:path';
import { scanSessionProjects, readSessionPreview } from '../discovery/sessionScanner';
import { getClaudeHomeDir, getSessionsRootDir } from '../utils/claudeHome';
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
  sessions: Array<{ fileName: string; sizeLabel: string; messageCount: number; preview?: string }>;
}

export class SessionsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'claudeMigrator.sessionsView';

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {
    this.disposables.push(
      operationStatus.onDidChangeStatus((event) => {
        this.post({ command: 'status', ...event });
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
    this.post({ command: 'projects', data: projects.map(serialize), sessionsRoot });
    this.post({ command: 'status', message: `Found ${projects.length} session project(s).`, done: true });
  }

  private post(message: Record<string, unknown>): void {
    this.view?.webview.postMessage(message);
  }

  private renderHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource}`,
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Claude Migrator</title>
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--vscode-foreground); padding: 0; margin: 0; }
  .toolbar { display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid var(--vscode-sideBar-border, transparent); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 8px; cursor: pointer; border-radius: 2px; font-size: 12px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  #status { padding: 4px 8px; color: var(--vscode-descriptionForeground); font-size: 11px; min-height: 14px; }
  #list { overflow-y: auto; }
  .project { border-bottom: 1px solid var(--vscode-sideBar-border, #3333); padding: 6px 8px; }
  .project-header { display: flex; justify-content: space-between; align-items: baseline; cursor: pointer; }
  .project-name { font-weight: 600; }
  .project-meta { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .project-actions { display: none; gap: 4px; margin-top: 4px; }
  .project.expanded .project-actions { display: flex; }
  .session-list { display: none; margin-top: 4px; padding-left: 8px; border-left: 2px solid var(--vscode-sideBar-border, #3333); }
  .project.expanded .session-list { display: block; }
  .session-item { padding: 3px 0; cursor: pointer; display: flex; align-items: baseline; gap: 6px; }
  .session-item:hover { color: var(--vscode-textLink-foreground); }
  .session-item .session-text { flex: 1; }
  .session-pick { flex: none; margin: 0; cursor: pointer; }
  button.danger { background: var(--vscode-inputValidation-errorBackground, #5a1d1d); color: var(--vscode-foreground); }
  button.danger:hover { background: var(--vscode-inputValidation-errorBorder, #be1100); }
  button.link-danger { background: none; color: var(--vscode-descriptionForeground); padding: 0 4px; }
  button.link-danger:hover { background: none; color: var(--vscode-errorForeground, #f48771); }
  .selection-bar { display: none; align-items: center; gap: 6px; margin-top: 4px; }
  .project.expanded.has-selection .selection-bar { display: flex; }
  .memory-badge { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .unknown-source { color: var(--vscode-editorWarning-foreground); }
  #preview { border-top: 2px solid var(--vscode-sideBar-border, #3333); padding: 8px; }
  #preview h4 { margin: 0 0 6px 0; }
  .turn { margin-bottom: 8px; padding: 4px 6px; border-radius: 3px; background: var(--vscode-editorWidget-background); }
  .turn .role { font-weight: 600; font-size: 11px; color: var(--vscode-textLink-foreground); }
  .turn .text { white-space: pre-wrap; font-size: 12px; margin-top: 2px; }
  .empty { padding: 16px 8px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <div class="toolbar">
    <button id="exportAll">Export Sessions...</button>
    <button id="importSessions" class="secondary">Import Sessions...</button>
    <button id="refresh" class="secondary" title="Refresh">&#x21bb;</button>
  </div>
  <div id="status">Loading...</div>
  <div id="list"></div>
  <div id="preview" style="display:none"></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const listEl = document.getElementById('list');
  const statusEl = document.getElementById('status');
  const previewEl = document.getElementById('preview');

  document.getElementById('exportAll').addEventListener('click', () => vscode.postMessage({ command: 'exportAll' }));
  document.getElementById('importSessions').addEventListener('click', () => vscode.postMessage({ command: 'importSessions' }));
  document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function render(projects, sessionsRoot) {
    if (!projects || projects.length === 0) {
      listEl.innerHTML = '<div class="empty">No Claude Code sessions found under<br>' + escapeHtml(sessionsRoot) + '</div>';
      return;
    }
    listEl.innerHTML = projects.map((p) => {
      const sourceLine = p.sourceKnown
        ? escapeHtml(p.sourcePath)
        : '<span class="unknown-source">unknown source (folder: ' + escapeHtml(p.folderName) + ')</span>';
      const gitLine = p.gitRemote ? ' &middot; ' + escapeHtml(p.gitRemote) : '';
      // Deleting the project takes the memory/ directory with it, so say so up front rather
      // than only in the confirmation dialog.
      const memoryLine = p.hasMemoryDir ? ' &middot; <span class="memory-badge">has memory/</span>' : '';
      const sessions = p.sessions.map((s) => (
        '<div class="session-item" data-folder="' + escapeHtml(p.folderPath) + '" data-file="' + escapeHtml(s.fileName) + '">' +
        '<input type="checkbox" class="session-pick" title="Select for deletion">' +
        '<span class="session-text">&#128172; ' + escapeHtml(s.preview || s.fileName) +
        ' <span class="project-meta">(' + s.messageCount + ' msgs, ' + s.sizeLabel + ')</span></span>' +
        '<button class="link-danger" data-action="delete-session" title="Delete this session">&#128465;</button>' +
        '</div>'
      )).join('');
      return (
        '<div class="project" data-id="' + escapeHtml(p.id) + '" data-folder="' + escapeHtml(p.folderPath) + '">' +
          '<div class="project-header">' +
            '<div><div class="project-name">' + escapeHtml(p.label) + '</div>' +
            '<div class="project-meta">' + sourceLine + gitLine + memoryLine + '</div></div>' +
            '<div class="project-meta">' + p.sessionCount + ' session(s)<br>' + p.sizeLabel + '</div>' +
          '</div>' +
          '<div class="project-actions">' +
            '<button data-action="export">Export</button>' +
            '<button data-action="reveal" class="secondary">Reveal</button>' +
            '<button data-action="delete-project" class="danger" title="Delete every session in this project">Delete Project</button>' +
          '</div>' +
          '<div class="selection-bar">' +
            '<button data-action="delete-selected" class="danger">Delete Selected (<span class="sel-count">0</span>)</button>' +
            '<button data-action="clear-selection" class="secondary">Clear</button>' +
          '</div>' +
          '<div class="session-list">' + sessions + '</div>' +
        '</div>'
      );
    }).join('');

    listEl.querySelectorAll('.project-header').forEach((el) => {
      el.addEventListener('click', () => el.closest('.project').classList.toggle('expanded'));
    });
    listEl.querySelectorAll('[data-action="export"]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.closest('.project').dataset.id;
        vscode.postMessage({ command: 'exportProject', id });
      });
    });
    listEl.querySelectorAll('[data-action="reveal"]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const folder = el.closest('.project').dataset.folder;
        vscode.postMessage({ command: 'reveal', folderPath: folder });
      });
    });
    listEl.querySelectorAll('.session-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        // The checkbox and the per-session delete button live inside the row; neither should
        // also open the preview.
        if (e.target.closest('.session-pick') || e.target.closest('[data-action="delete-session"]')) {
          return;
        }
        e.stopPropagation();
        vscode.postMessage({ command: 'preview', folderPath: el.dataset.folder, fileName: el.dataset.file });
      });
    });

    listEl.querySelectorAll('[data-action="delete-project"]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        vscode.postMessage({ command: 'deleteProject', id: el.closest('.project').dataset.id });
      });
    });
    listEl.querySelectorAll('[data-action="delete-session"]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const project = el.closest('.project');
        const fileName = el.closest('.session-item').dataset.file;
        vscode.postMessage({ command: 'deleteSessions', id: project.dataset.id, fileNames: [fileName] });
      });
    });
    listEl.querySelectorAll('.session-pick').forEach((el) => {
      el.addEventListener('change', (e) => {
        e.stopPropagation();
        updateSelection(el.closest('.project'));
      });
    });
    listEl.querySelectorAll('[data-action="delete-selected"]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const project = el.closest('.project');
        const fileNames = selectedFileNames(project);
        if (fileNames.length === 0) {
          return;
        }
        vscode.postMessage({ command: 'deleteSessions', id: project.dataset.id, fileNames });
      });
    });
    listEl.querySelectorAll('[data-action="clear-selection"]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const project = el.closest('.project');
        project.querySelectorAll('.session-pick').forEach((cb) => { cb.checked = false; });
        updateSelection(project);
      });
    });
  }

  function selectedFileNames(project) {
    return Array.from(project.querySelectorAll('.session-pick'))
      .filter((cb) => cb.checked)
      .map((cb) => cb.closest('.session-item').dataset.file);
  }

  function updateSelection(project) {
    const count = selectedFileNames(project).length;
    project.classList.toggle('has-selection', count > 0);
    const counter = project.querySelector('.sel-count');
    if (counter) {
      counter.textContent = String(count);
    }
  }

  function renderPreview(title, turns) {
    previewEl.style.display = 'block';
    if (!turns || turns.length === 0) {
      previewEl.innerHTML = '<h4>' + escapeHtml(title) + '</h4><div class="empty">No readable turns in this session.</div>';
      return;
    }
    previewEl.innerHTML = '<h4>' + escapeHtml(title) + '</h4>' + turns.map((t) => (
      '<div class="turn"><div class="role">' + escapeHtml(t.role) + '</div><div class="text">' + escapeHtml(t.text) + '</div></div>'
    )).join('');
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'projects') {
      render(msg.data, msg.sessionsRoot);
    } else if (msg.command === 'status') {
      statusEl.textContent = msg.message || '';
    } else if (msg.command === 'previewResult') {
      renderPreview(msg.title, msg.turns);
    } else if (msg.command === 'error') {
      statusEl.textContent = 'Error: ' + msg.message;
    }
  });

  vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
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
