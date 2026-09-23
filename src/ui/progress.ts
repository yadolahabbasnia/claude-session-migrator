import * as vscode from 'vscode';
import { operationStatus } from './operationStatus';

export interface ProgressReporter {
  report(message: string, incrementPercent?: number): void;
  isCancelled(): boolean;
}

/**
 * Runs a cancellable long-running operation under VS Code's notification progress UI, never
 * blocking the extension host's event loop (the task itself must remain async). Every report()
 * call is also broadcast on the operationStatus bus so the sidebar can mirror live progress.
 */
export async function withCancellableProgress<T>(
  title: string,
  task: (reporter: ProgressReporter) => Promise<T>,
): Promise<T> {
  operationStatus.report({ message: title });
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true,
      },
      async (progress, token) => {
        const reporter: ProgressReporter = {
          report: (message, incrementPercent) => {
            progress.report({ message, increment: incrementPercent });
            operationStatus.report({ message: `${title}: ${message}` });
          },
          isCancelled: () => token.isCancellationRequested,
        };
        return task(reporter);
      },
    );
    operationStatus.report({ message: `${title} -- done.`, done: true });
    return result;
  } catch (err) {
    operationStatus.report({ message: `${title} -- failed: ${(err as Error).message}`, done: true });
    throw err;
  }
}
