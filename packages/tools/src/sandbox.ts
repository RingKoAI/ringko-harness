import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { ensureWindowsSandbox, prepareWindowsAcl } from "./windows-runner.ts";
import { SandboxDeniedError, SandboxUnavailableError } from "./sandbox-errors.ts";

export { SandboxDeniedError, SandboxUnavailableError };
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type SandboxRunner = "bwrap" | "seatbelt" | "windows-acl" | "none";

const MODES: readonly SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

function canonicalDirectory(path: string): string {
  const absolute = resolve(path);
  try {
    const resolved = realpathSync(absolute);
    if (!statSync(resolved).isDirectory()) throw new TypeError(`Sandbox root is not a directory: ${path}`);
    return resolved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return absolute;
    throw error;
  }
}

function within(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function detectRunner(): SandboxRunner {
  if (process.platform === "win32") return "windows-acl";
  if (process.platform === "linux") {
    const probe = spawnSync("bwrap", ["--version"], { stdio: "ignore" });
    return probe.status === 0 ? "bwrap" : "none";
  }
  if (process.platform === "darwin") {
    const probe = spawnSync("/usr/bin/sandbox-exec", ["-h"], { stdio: "ignore" });
    return probe.error === undefined ? "seatbelt" : "none";
  }
  return "none";
}

function shellCommand(command: string): { executable: string; args: string[] } {
  return process.platform === "win32"
    ? { executable: "cmd.exe", args: ["/d", "/s", "/c", command] }
    : { executable: "/bin/sh", args: ["-c", command] };
}

/**
 * Host-local sandbox policy. File writes are bounded in-process; process
 * effects require a platform runner and fail closed when one is unavailable.
 */
export class Sandbox {
  readonly mode: SandboxMode;
  readonly workspaceRoot: string;
  readonly additionalWritableRoots: readonly string[];
  readonly runner: SandboxRunner;
  readonly enforcement: "full" | "partial" | "none";
  private tempDirectory?: string;

  constructor(options: { workspace: string; mode?: SandboxMode; additionalWritableRoots?: readonly string[]; runner?: SandboxRunner }) {
    const mode = options.mode ?? "workspace-write";
    if (!MODES.includes(mode)) throw new TypeError(`Invalid sandbox mode: ${String(mode)}`);
    this.mode = mode;
    this.workspaceRoot = canonicalDirectory(options.workspace);
    this.additionalWritableRoots = (options.additionalWritableRoots ?? []).map(root =>
      canonicalDirectory(isAbsolute(root) ? root : resolve(this.workspaceRoot, root)),
    );
    this.runner = options.runner ?? detectRunner();
    this.enforcement = mode === "danger-full-access" ? "none" : this.runner === "none" ? "none" : this.runner === "windows-acl" ? "partial" : "full";
  }

  private writable(path: string): boolean {
    return within(this.workspaceRoot, path) || this.additionalWritableRoots.some(root => within(root, path));
  }

  /** Enforce a write/delete target before the operation touches disk. */
  assertWrite(path: string): void {
    if (this.mode === "danger-full-access") return;
    if (this.mode === "read-only") {
      if (within(this.temp(), path)) return;
      throw new SandboxDeniedError(`Sandbox mode read-only denies writes outside its private temp: ${path}`);
    }
    if (!this.writable(path)) throw new SandboxDeniedError(`Write outside the workspace is denied: ${path}`);
  }

  private temp(): string {
    this.tempDirectory ??= mkdtempSync(join(tmpdir(), "ringko-sandbox-"));
    return this.tempDirectory;
  }

  /** Wrap an arbitrary host process and its descendants under the active policy. */
  wrap(executable: string, args: readonly string[], cwd = this.workspaceRoot): { executable: string; args: string[]; cwd: string } {
    if (this.mode === "danger-full-access") return { executable, args: [...args], cwd };
    if (this.runner === "none") {
      throw new SandboxUnavailableError(
        `Sandbox mode ${this.mode} requires a process runner. Set sandbox.mode to danger-full-access or install bubblewrap (Linux), sandbox-exec (macOS), or the Windows ACL runner.`,
      );
    }
    if (this.runner === "windows-acl") {
      if (this.additionalWritableRoots.length > 0) throw new SandboxUnavailableError("Additional writable roots are not supported by the Windows runner.");
      const helper = ensureWindowsSandbox();
      prepareWindowsAcl(this.mode as "read-only" | "workspace-write", this.workspaceRoot, this.temp());
      return { executable: helper, args: [this.mode, this.workspaceRoot, this.temp(), cwd, "--", executable, ...args], cwd };
    }
    if (this.runner === "bwrap") {
      const wrapped = ["--die-with-parent", "--ro-bind", "/", "/", "--dev", "/dev", "--unshare-pid", "--unshare-ipc", "--proc", "/proc", "--tmpfs", "/tmp", "--chdir", cwd];
      if (this.mode === "workspace-write") {
        wrapped.push("--bind", this.workspaceRoot, this.workspaceRoot);
        for (const root of this.additionalWritableRoots) wrapped.push("--bind", root, root);
      } else {
        wrapped.push("--ro-bind", this.workspaceRoot, this.workspaceRoot);
      }
      wrapped.push("--", executable, ...args);
      return { executable: "bwrap", args: wrapped, cwd };
    }
    const temp = this.temp();
    const profile = [
      "(version 1)",
      "(allow default)",
      "(deny file-write*)",
      `(allow file-write* (subpath ${JSON.stringify(temp)}))`,
      '(allow file-write* (subpath "/tmp"))',
      '(allow file-write* (subpath "/private/tmp"))',
      ...(this.mode === "workspace-write"
        ? [
            `(allow file-write* (subpath ${JSON.stringify(this.workspaceRoot)}))`,
            ...this.additionalWritableRoots.map(root => `(allow file-write* (subpath ${JSON.stringify(root)}))`),
          ]
        : []),
    ].join(" ");
    return { executable: "/usr/bin/sandbox-exec", args: ["-p", profile, executable, ...args], cwd };
  }

  /** Wrap a shell command, or fail closed when process confinement is unavailable. */
  shell(command: string, cwd = this.workspaceRoot): { executable: string; args: string[]; cwd: string } {
    const shell = shellCommand(command);
    return this.wrap(shell.executable, shell.args, cwd);
  }

  /** Wrap an interactive shell for a PTY without changing its stdio shape. */
  pty(executable: string, args: readonly string[], cwd = this.workspaceRoot): { executable: string; args: string[]; cwd: string } {
    if (process.platform === "win32" && this.mode !== "danger-full-access") {
      throw new SandboxUnavailableError("Interactive terminals are not supported by the Windows sandbox runner; use the shell tool or explicitly select danger-full-access.");
    }
    return this.wrap(executable, args, cwd);
  }
}






