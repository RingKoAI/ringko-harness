import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

export const REVIEW_LIMITS = { entries: 200, bytes: 262144, path: 4096, gitTimeout: 5000 } as const;
const execute = promisify(execFile);
/** Read-only UI access. Paths are relative, links are rejected, outputs are bounded. */
export class WorkspaceReview {
  constructor(private root: string) {}
  private async target(path: string): Promise<{ root: string; target: string }> {
    if (typeof path !== 'string' || path.length > REVIEW_LIMITS.path || path.includes('\0') || isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part.includes(':'))) throw new Error('Invalid workspace-relative path.');
    const root = await realpath(this.root); const candidate = resolve(root, path || '.');
    const rel = relative(root, candidate);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Path is outside the workspace.');
    let current = root;
    for (const part of rel.split(sep).filter(Boolean)) { current = join(current, part); if ((await lstat(current)).isSymbolicLink()) throw new Error('Links cannot be opened in the workspace viewer.'); }
    const target = await realpath(candidate); const canonical = relative(root, target);
    if (isAbsolute(canonical) || canonical === '..' || canonical.startsWith(`..${sep}`)) throw new Error('Path is outside the workspace.');
    return { root, target };
  }
  async list(path = '') {
    const { target } = await this.target(path);
    const entries = [];
    for await (const item of await opendir(target)) {
      if (!item.isSymbolicLink() && item.name !== '.git' && (item.isFile() || item.isDirectory())) entries.push(item);
      if (entries.length > REVIEW_LIMITS.entries) break;
    }
    const visible = entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    return { path, truncated: visible.length > REVIEW_LIMITS.entries, entries: visible.slice(0, REVIEW_LIMITS.entries).map(item => ({ name: item.name, path: [path, item.name].filter(Boolean).join('/'), directory: item.isDirectory() })) };
  }
  async read(path: string) {
    const { target } = await this.target(path);
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('Only regular files can be previewed.');
      const buffer = Buffer.alloc(REVIEW_LIMITS.bytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (buffer.subarray(0, bytesRead).includes(0)) return { path, binary: true, content: '', truncated: false };
      return { path, binary: false, content: buffer.subarray(0, Math.min(bytesRead, REVIEW_LIMITS.bytes)).toString('utf8'), truncated: bytesRead > REVIEW_LIMITS.bytes };
    } finally { await handle.close(); }
  }
  async diff(path: string, signal?: AbortSignal) {
    // Deleted files are inspected through the root diff. Selected files must exist and pass containment.
    const { root } = await this.target(path);
    const result = await execute('git', ['-C', root, '-c', 'core.fsmonitor=false', 'diff', '--no-ext-diff', '--no-textconv', '--no-color', 'HEAD', '--', path || '.'], { timeout: REVIEW_LIMITS.gitTimeout, maxBuffer: REVIEW_LIMITS.bytes, windowsHide: true, signal });
    return { path, content: result.stdout };
  }
}
