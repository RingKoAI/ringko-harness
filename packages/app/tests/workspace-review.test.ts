import { expect, it } from 'bun:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceReview, REVIEW_LIMITS } from '../src/workspace-review';

it('confines previews to regular workspace files and rejects junction traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rkh-review-'));
  try {
    const workspace = join(root, 'workspace'); const outside = join(root, 'outside'); await mkdir(workspace); await mkdir(outside);
    await writeFile(join(workspace, 'text.txt'), '<script>untrusted</script>'); await writeFile(join(outside, 'secret'), 'outside');
    await symlink(outside, join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const review = new WorkspaceReview(workspace);
    expect((await review.read('text.txt')).content).toContain('<script>');
    expect((await review.list()).entries.map(item => item.name)).toEqual(['text.txt']);
    for (const path of ['../outside/secret', 'escape/secret', 'file\0', 'C:\\secret']) await expect(review.read(path)).rejects.toThrow();
    await writeFile(join(workspace, 'binary'), Buffer.from([0, 1, 2])); expect((await review.read('binary')).binary).toBe(true);
    await writeFile(join(workspace, 'large'), 'x'.repeat(REVIEW_LIMITS.bytes + 100)); expect((await review.read('large')).truncated).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }) }
});
