import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';

export async function sha256File(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return sha256Buffer(buffer);
}

export function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** archive-relative-path -> sha256 hex digest. */
export type ChecksumMap = Record<string, string>;
