import * as vscode from 'vscode';

export interface OperationStatusEvent {
  message: string;
  /** 0-100, or undefined for an indeterminate step. */
  percent?: number;
  /** True on the final event of an operation (success or failure). */
  done?: boolean;
}

/**
 * A tiny broadcast bus so the sidebar can show live status for whatever export/import operation
 * is currently running through the native VS Code progress UI, without the wizards needing to
 * know the sidebar exists.
 */
class OperationStatusBus {
  private readonly emitter = new vscode.EventEmitter<OperationStatusEvent>();
  readonly onDidChangeStatus = this.emitter.event;

  report(event: OperationStatusEvent): void {
    this.emitter.fire(event);
  }
}

export const operationStatus = new OperationStatusBus();
