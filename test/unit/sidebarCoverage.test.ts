import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  contributes: { commands: Array<{ command: string }> };
};
const provider = fs.readFileSync(path.join(root, 'src/ui/sessionsViewProvider.ts'), 'utf8');

// Only reachable from the Explorer's right-click menu, where the folder is the context.
const EXPLORER_ONLY = new Set(['claudeMigrator.exportFolder']);

describe('sidebar coverage', () => {
  it('can trigger every contributed command', () => {
    const missing = pkg.contributes.commands
      .map((c) => c.command)
      .filter((id) => !EXPLORER_ONLY.has(id))
      .filter((id) => !provider.includes(`'${id}'`));
    expect(missing).toEqual([]);
  });
});
