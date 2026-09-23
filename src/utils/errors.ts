/** Typed error hierarchy so callers can branch on failure kind instead of parsing messages. */

export class MigratorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class PermissionDeniedError extends MigratorError {
  constructor(public readonly targetPath: string) {
    super(`Permission denied: ${targetPath}`, 'PERMISSION_DENIED');
  }
}

export class PathNotFoundError extends MigratorError {
  constructor(public readonly targetPath: string) {
    super(`Path not found: ${targetPath}`, 'PATH_NOT_FOUND');
  }
}

export class InvalidArchiveError extends MigratorError {
  constructor(message: string) {
    super(message, 'INVALID_ARCHIVE');
  }
}

export class UnsupportedFormatVersionError extends MigratorError {
  constructor(public readonly foundVersion: number, public readonly maxSupported: number) {
    super(
      `Archive format version ${foundVersion} is not supported (max supported: ${maxSupported}). Update the extension.`,
      'UNSUPPORTED_FORMAT_VERSION',
    );
  }
}

export class ChecksumMismatchError extends MigratorError {
  constructor(public readonly file: string) {
    super(`Checksum mismatch for archived file: ${file}`, 'CHECKSUM_MISMATCH');
  }
}

export class InsufficientDiskSpaceError extends MigratorError {
  constructor(public readonly requiredBytes: number, public readonly availableBytes: number) {
    super(
      `Insufficient disk space: need ${requiredBytes} bytes, only ${availableBytes} available.`,
      'INSUFFICIENT_DISK_SPACE',
    );
  }
}

export class OperationCancelledError extends MigratorError {
  constructor() {
    super('Operation cancelled by user.', 'CANCELLED');
  }
}

export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/** Maps common Node.js filesystem errno codes onto our typed errors. */
export function toMigratorError(err: unknown, targetPath: string): Error {
  if (isNodeError(err)) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return new PermissionDeniedError(targetPath);
    }
    if (err.code === 'ENOENT') {
      return new PathNotFoundError(targetPath);
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}
