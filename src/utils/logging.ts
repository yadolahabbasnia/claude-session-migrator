/**
 * A small logging abstraction decoupled from vscode.OutputChannel so core logic stays testable.
 * extension.ts wires a real sink (the "Claude Migrator" OutputChannel) at activation time.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogSink {
  append(line: string): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

/** Redacts values that look like secrets before they ever reach the log sink. */
const SENSITIVE_KEY_PATTERN = /(secret|token|password|api[-_]?key|private[-_]?key|credential)/i;

export class Logger {
  private sink: LogSink | undefined;
  private minLevel: LogLevel = 'INFO';

  setSink(sink: LogSink | undefined): void {
    this.sink = sink;
  }

  setDebugEnabled(enabled: boolean): void {
    this.minLevel = enabled ? 'DEBUG' : 'INFO';
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('DEBUG', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('INFO', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('WARN', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('ERROR', message, context);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel] || !this.sink) {
      return;
    }
    const timestamp = new Date().toISOString();
    let line = `[${timestamp}] [${level}] ${message}`;
    if (context) {
      line += ` ${JSON.stringify(redactSensitive(context))}`;
    }
    this.sink.append(line);
  }
}

function redactSensitive(context: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : value;
  }
  return result;
}

/** Shared singleton logger used throughout the extension. */
export const logger = new Logger();
