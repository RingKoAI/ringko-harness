// Tracks the on-disk version of files a tool has touched, so reads can warn the
// model when a file changed since it was last read, and edits/writes can mark
// the file as changed.

export interface FileVersion {
  mtimeMs: number;
  size: number;
}

/** A shared, per-registration record of file versions. */
export class FileTracker {
  private readonly versions = new Map<string, FileVersion>();

  /** Record the current version of a file. */
  record(absolutePath: string, stats: FileVersion): void {
    this.versions.set(absolutePath, { mtimeMs: stats.mtimeMs, size: stats.size });
  }

  /** True when the file differs from the last recorded version. */
  changedSinceLastRead(absolutePath: string, stats: FileVersion): boolean {
    const previous = this.versions.get(absolutePath);
    if (!previous) return false;
    return previous.mtimeMs !== stats.mtimeMs || previous.size !== stats.size;
  }
}
