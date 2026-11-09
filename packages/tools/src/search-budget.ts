import { SEARCH_LIMITS } from "./limits.ts";

export class SearchBudget {
  private bytes = 0;
  private files = 0;
  constructor(private readonly limits: { files: number; totalBytes: number } = SEARCH_LIMITS) {}
  get remainingBytes(): number { return this.limits.totalBytes - this.bytes; }
  file(): void {
    if (++this.files > this.limits.files) throw new Error("Grep exceeded its file-count budget; narrow path or glob.");
  }
  consume(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limits.totalBytes - this.bytes) throw new Error("Grep exceeded its cumulative byte budget; narrow path or glob.");
    this.bytes += bytes;
  }
}
