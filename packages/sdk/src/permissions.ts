import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ringkoRoot, writeDiagnostic } from "@ringko-ai/config";
import type { ApprovalHandler } from "./index.ts";

export interface PermissionRule { tool: string; target?: string; behavior: "allow" | "deny" | "ask" }
const MAX_RULES = 512;
const MAX_FILE_BYTES = 256 * 1024;

function validateRules(value: unknown): PermissionRule[] {
  if (!Array.isArray(value) || value.length > MAX_RULES) throw new TypeError("Invalid permission rules.");
  return value.map(rule => {
    if (!rule || typeof rule !== "object" || Object.keys(rule).some(key => !["tool", "target", "behavior"].includes(key)) ||
      typeof rule.tool !== "string" || !rule.tool || rule.tool.length > 128 ||
      (rule.target !== undefined && (typeof rule.target !== "string" || rule.target.length > 8192)) ||
      !["allow", "deny", "ask"].includes(rule.behavior)) throw new TypeError("Invalid permission rule.");
    return { tool: rule.tool, behavior: rule.behavior, ...(rule.target !== undefined ? { target: rule.target } : {}) };
  });
}

/** Exact tool and assessed-target matching; grants never originate in model input. */
export class PermissionManager {
  readonly path: string;
  private readonly sessions = new Map<string, PermissionRule[]>();
  constructor(workspace: string) {
    const key = createHash("sha256").update(resolve(workspace)).digest("hex");
    this.path = join(ringkoRoot(), "permissions", `${key}.json`);
  }
  private saved(): PermissionRule[] {
    if (!existsSync(this.path)) return [];
    const descriptor = openSync(this.path, "r");
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let size = 0;
    try {
      if (!fstatSync(descriptor).isFile()) throw new Error("Permission file must be regular.");
      while (size < buffer.length) {
        const count = readSync(descriptor, buffer, size, buffer.length - size, size);
        if (!count) break;
        size += count;
      }
    } finally { closeSync(descriptor); }
    if (size > MAX_FILE_BYTES) throw new Error("Permission file exceeds 256 KiB.");
    const data = buffer.subarray(0, size);
    const parsed = JSON.parse(data.toString("utf8"));
    if (parsed.version !== 1) throw new Error("Unsupported permission file version.");
    return validateRules(parsed.rules);
  }
  decide(session: string, tool: string, target?: string): "allow" | "deny" | "ask" | "default" {
    const rules = [...this.saved(), ...(this.sessions.get(session) ?? [])].filter(rule => rule.tool === tool && (rule.target === undefined || rule.target === target));
    for (const behavior of ["deny", "ask", "allow"] as const) if (rules.some(rule => rule.behavior === behavior)) return behavior;
    return "default";
  }
  list(session: string, scope: "session" | "saved"): PermissionRule[] {
    if (scope !== "session" && scope !== "saved") throw new TypeError("Invalid permission scope.");
    return (scope === "saved" ? this.saved() : this.sessions.get(session) ?? []).map(rule => ({ ...rule }));
  }
  clearSession(session: string): void { this.sessions.delete(session); }
  clearSessions(): void { this.sessions.clear(); }

  private updateSaved(change: (rules: PermissionRule[]) => PermissionRule[] | undefined): boolean {
    mkdirSync(join(ringkoRoot(), "permissions"), { recursive: true, mode: 0o700 });
    let lock: number;
    try { lock = openSync(`${this.path}.lock`, "wx", 0o600); } catch { throw new Error(`Permission rules are locked; retry or remove the stale lock after confirming no writer is active: ${this.path}.lock`); }
    try {
      const next = change(this.saved());
      if (!next) return false;
      validateRules(next);
      const data = JSON.stringify({ version: 1, rules: next });
      if (Buffer.byteLength(data) > MAX_FILE_BYTES) throw new Error("Permission rules exceed 256 KiB.");
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, data, { flag: "wx", mode: 0o600 });
        renameSync(temporary, this.path);
      } finally { if (existsSync(temporary)) unlinkSync(temporary); }
      return true;
    } finally { closeSync(lock); unlinkSync(`${this.path}.lock`); }
  }

  add(session: string, rule: PermissionRule, scope: "session" | "saved"): void {
    if (scope !== "session" && scope !== "saved") throw new TypeError("Invalid permission scope.");
    rule = validateRules([rule])[0]!;
    const append = (rules: PermissionRule[]) => [...rules.filter(existing => !(existing.tool === rule.tool && existing.target === rule.target && existing.behavior === rule.behavior)), rule];
    if (scope === "session") {
      const next = append(this.sessions.get(session) ?? []);
      validateRules(next);
      this.sessions.set(session, next);
    } else this.updateSaved(append);
    writeDiagnostic("permission.update", JSON.stringify({ tool: rule.tool, behavior: rule.behavior, scope }));
  }
  remove(session: string, rule: PermissionRule, scope: "session" | "saved"): boolean {
    if (scope !== "session" && scope !== "saved") throw new TypeError("Invalid permission scope.");
    rule = validateRules([rule])[0]!;
    const without = (rules: PermissionRule[]) => rules.filter(existing => !(existing.tool === rule.tool && existing.target === rule.target && existing.behavior === rule.behavior));
    let removed = false;
    if (scope === "session") {
      const rules = this.sessions.get(session) ?? [];
      const next = without(rules);
      removed = next.length !== rules.length;
      if (removed) { if (next.length) this.sessions.set(session, next); else this.sessions.delete(session); }
    } else removed = this.updateSaved(rules => {
      const next = without(rules);
      return next.length === rules.length ? undefined : next;
    });
    if (removed) writeDiagnostic("permission.remove", JSON.stringify({ tool: rule.tool, behavior: rule.behavior, scope }));
    return removed;
  }
  approval(session: string, handler?: ApprovalHandler): ApprovalHandler | undefined {
    if (!handler) return undefined;
    return async request => {
      let scope: "session" | "saved" | undefined;
      const approved = await handler({ ...request, remember: selected => { scope = selected; } });
      request.signal?.throwIfAborted();
      if (this.decide(session, request.toolName, request.target) === "deny") return false;
      if (approved && scope) this.add(session, { tool: request.toolName, target: request.target, behavior: "allow" }, scope);
      return approved === true;
    };
  }
}
