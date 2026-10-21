import { EventEmitter } from 'node:events';

export type WatcherState = 'off' | 'idle' | 'pending' | 'syncing';

export interface SyncRuntimeState {
  watcher: WatcherState;
  /** ISO time the debounced auto-sync is due to run, while `watcher` is `'pending'`. */
  nextSyncAt?: string;
  lastAuto?: { at: string; ok: boolean; pushed: boolean; message?: string };
  lastManual?: { at: string; kind: 'push' | 'pull'; ok: boolean; message?: string };
}

/** In-memory record of what the sync machinery is doing right now and how the last runs ended,
 * so the sidebar can show it live. Reset when the extension host restarts -- git itself is the
 * durable record of what was last pushed. */
class SyncRuntime {
  private state: SyncRuntimeState = { watcher: 'off' };
  private readonly emitter = new EventEmitter();

  get(): SyncRuntimeState {
    return this.state;
  }

  update(patch: Partial<SyncRuntimeState>): void {
    this.state = { ...this.state, ...patch };
    this.emitter.emit('change', this.state);
  }

  onDidChange(listener: (state: SyncRuntimeState) => void): { dispose: () => void } {
    this.emitter.on('change', listener);
    return { dispose: () => this.emitter.off('change', listener) };
  }
}

export const syncRuntime = new SyncRuntime();
