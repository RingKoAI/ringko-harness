import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { ensureWindowsSandbox, prepareWindowsAcl, prepareWindowsSandbox } from "./windows-runner.ts";
import { shellCommand, type ShellKind } from "./shell-resolver.ts";
import { SandboxDeniedError, SandboxUnavailableError } from "./sandbox-errors.ts";
import { sandboxEnvironment } from "./sandbox-environment.ts";

export { SandboxDeniedError, SandboxUnavailableError };
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type SandboxRunner = "bwrap" | "seatbelt" | "windows-acl" | "none";
export interface SandboxedProcess {
  executable: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Native terminal launchers speak the same control/event protocol as the bridge. */
  protocol?: "jsonl";
  windowsVerbatimArguments?: boolean;
  /** Shell family that built this invocation, when it came from `shell()`. */
  shellKind?: ShellKind;
}

const MODES: readonly SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];
const MAX_NEW_PATH_DEPTH = 256;
const MAX_WRITABLE_ROOTS = 64;
const DEFAULT_TERMINAL_SIZE = { cols: 80, rows: 24 };

/** Resolve aliases through the nearest existing ancestor of a new target. */
function canonicalTarget(path: string): string {
  let candidate = resolve(path);
  const suffix: string[] = [];
  for (let depth = 0; depth <= MAX_NEW_PATH_DEPTH; depth += 1) {
    try { return join(realpathSync(candidate), ...suffix.reverse()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      suffix.push(basename(candidate));
      candidate = parent;
    }
  }
  throw new SandboxDeniedError("Sandbox target path exceeds the supported nesting depth.");
}

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
  if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))) return true;
  if (process.platform !== "win32") return false;
  // A Windows realpath can retain an 8.3 spelling. Resolve ancestry by file
  // identity when lexical components differ, without trusting string prefixes.
  const boundary = statSync(root, { bigint: true });
  if (!boundary.isDirectory() || boundary.ino === 0n) return false;
  let ancestor = candidate;
  for (let depth = 0; depth <= MAX_NEW_PATH_DEPTH; depth += 1) {
    try {
      const entry = statSync(ancestor, { bigint: true });
      if (entry.isDirectory() && entry.dev === boundary.dev && entry.ino === boundary.ino) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) return false;
    ancestor = parent;
  }
  return false;
}

function detectRunner(): SandboxRunner {
  if (process.platform === "win32") return "windows-acl";
  if (process.platform === "linux") {
    const executable = Bun.which("bwrap");
    if (!executable) return "none";
    const probe = spawnSync(executable, ["--version"], { stdio: "ignore", env: sandboxEnvironment(tmpdir()) });
    return probe.status === 0 ? "bwrap" : "none";
  }
  if (process.platform === "darwin") {
    const probe = spawnSync("/usr/bin/sandbox-exec", ["-h"], { stdio: "ignore", env: sandboxEnvironment(tmpdir()) });
    return probe.error === undefined ? "seatbelt" : "none";
  }
  return "none";
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
  private readonly runnerExecutable: string;
  private tempDirectory?: string;

  constructor(options: { workspace: string; mode?: SandboxMode; additionalWritableRoots?: readonly string[]; runner?: SandboxRunner }) {
    const mode = options.mode ?? "workspace-write";
    if (!MODES.includes(mode)) throw new TypeError(`Invalid sandbox mode: ${String(mode)}`);
    this.mode = mode;
    const resolveRoot = (value: string) => {
      const absolute = resolve(value);
      if (process.platform === "win32" && mode !== "danger-full-access" && !/^(?:[A-Za-z]:[\\/]|\\\\\?\\[A-Za-z]:[\\/])/.test(absolute)) {
        throw new SandboxUnavailableError("Windows sandbox roots require a local drive path; UNC and device roots are unsupported.");
      }
      return canonicalDirectory(absolute);
    };
    this.workspaceRoot = resolveRoot(options.workspace);
    const rootKey = (path: string) => process.platform === "win32" ? path.toLowerCase() : path;
    const seenRoots = new Set([rootKey(this.workspaceRoot)]);
    this.additionalWritableRoots = (options.additionalWritableRoots ?? []).map(root =>
      resolveRoot(isAbsolute(root) ? root : resolve(this.workspaceRoot, root)),
    ).filter(root => {
      const key = rootKey(root);
      if (seenRoots.has(key)) return false;
      seenRoots.add(key);
      return true;
    });
    if (this.additionalWritableRoots.length >= MAX_WRITABLE_ROOTS) throw new TypeError("Too many writable sandbox roots.");
    for (const root of this.additionalWritableRoots) {
      if (!statSync(root).isDirectory()) throw new TypeError(`Sandbox root is not a directory: ${root}`);
    }
    this.runner = options.runner ?? detectRunner();
    this.runnerExecutable = this.runner === "bwrap" ? Bun.which("bwrap") ?? "/usr/bin/bwrap" : "/usr/bin/sandbox-exec";
    this.enforcement = mode === "danger-full-access" ? "none" : this.runner === "none" ? "none" : this.runner === "windows-acl" ? "partial" : "full";
  }

  private writable(path: string): boolean {
    return within(this.workspaceRoot, path) || this.additionalWritableRoots.some(root => within(root, path));
  }

  /** Enforce a write/delete target before the operation touches disk. */
  assertWrite(path: string): void {
    if (this.mode === "danger-full-access") return;
    const target = canonicalTarget(path);
    if (this.mode === "read-only") {
      if (within(realpathSync(this.temp()), target)) return;
      throw new SandboxDeniedError(`Sandbox mode read-only denies writes outside its private temp: ${path}`);
    }
    if (!this.writable(target)) throw new SandboxDeniedError(`Write outside the workspace is denied: ${path} (resolved: ${target}; workspace: ${this.workspaceRoot})`);
  }

  private temp(): string {
    this.tempDirectory ??= realpathSync(mkdtempSync(join(tmpdir(), "ringko-sandbox-")));
    return this.tempDirectory;
  }

  /** Prewarm process confinement asynchronously; wrap remains a synchronous compatibility API. */
  async prepare(environment?: Readonly<Record<string, string>>): Promise<void> {
    if (this.mode === "danger-full-access") return;
    sandboxEnvironment(this.runner === "windows-acl" ? this.temp() : tmpdir(), environment);
    if (this.runner === "windows-acl") await prepareWindowsSandbox(this.mode, this.workspaceRoot, this.temp(), this.mode === "workspace-write" ? this.additionalWritableRoots : []);
  }

  /** Wrap an arbitrary host process and its descendants under the active policy. */
  wrap(executable: string, args: readonly string[], cwd = this.workspaceRoot, environment?: Readonly<Record<string, string>>): SandboxedProcess {
    if (this.mode === "danger-full-access") return { executable, args: [...args], cwd, ...(environment ? { env: { ...process.env, ...environment } } : {}) };
    if (this.runner === "none") {
      throw new SandboxUnavailableError(
        `Sandbox mode ${this.mode} requires a process runner. Set sandbox.mode to danger-full-access or install bubblewrap (Linux), sandbox-exec (macOS), or the Windows ACL runner.`,
      );
    }
    if (this.runner === "windows-acl") {
      return this.windowsProcess(executable, args, cwd, undefined, environment);
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
      return { executable: this.runnerExecutable, args: wrapped, cwd, env: sandboxEnvironment("/tmp", environment) };
    }
    const temp = this.temp();
    const profile = [
      "(version 1)",
      "(allow default)",
      "(deny file-write*)",
      `(allow file-write* (subpath ${JSON.stringify(temp)}))`,
      '(allow file-write* (literal "/dev/null"))',
      ...(this.mode === "workspace-write"
        ? [
            `(allow file-write* (subpath ${JSON.stringify(this.workspaceRoot)}))`,
            ...this.additionalWritableRoots.map(root => `(allow file-write* (subpath ${JSON.stringify(root)}))`),
          ]
        : []),
    ].join(" ");
    return { executable: "/usr/bin/sandbox-exec", args: ["-p", profile, executable, ...args], cwd, env: sandboxEnvironment(temp, environment) };
  }

  private windowsProcess(executable: string, args: readonly string[], cwd: string, size?: { cols: number; rows: number }, environment?: Readonly<Record<string, string>>): SandboxedProcess {
    const env = sandboxEnvironment(this.temp(), environment);
    const helper = ensureWindowsSandbox();
    const roots = this.mode === "workspace-write" ? this.additionalWritableRoots : [];
    prepareWindowsAcl(this.mode as "read-only" | "workspace-write", this.workspaceRoot, this.temp(), roots);
    return {
      executable: helper,
      args: [this.mode, this.workspaceRoot, this.temp(), cwd,
        ...roots.flatMap(root => ["--writable-root", root]),
        ...(size ? ["--pty", String(size.cols), String(size.rows)] : []),
        ...Object.keys(environment ?? {}).flatMap(name => ["--allow-env", name]),
        "--", executable, ...args],
      cwd,
      env,
      ...(size ? { protocol: "jsonl" as const } : {}),
    };
  }

  /** Wrap a shell command, or fail closed when process confinement is unavailable. */
  shell(command: string, cwd = this.workspaceRoot): SandboxedProcess {
    // Git Bash's MSYS runtime cannot initialize under the restricted-token
    // Windows sandbox, so it is only selected outside that boundary.
    const shell = shellCommand(command, process.platform, process.env, {
      preferGitBash: this.mode === "danger-full-access",
    });
    if (process.platform === "win32" && this.mode === "danger-full-access") {
      return shell.kind === "cmd"
        ? { executable: shell.executable, args: ["/d", "/s", "/c", `"${command}"`], cwd, windowsVerbatimArguments: true, shellKind: shell.kind }
        : { executable: shell.executable, args: shell.args, cwd, shellKind: shell.kind };
    }
    return { ...this.wrap(shell.executable, shell.args, cwd), shellKind: shell.kind };
  }

  /** Wrap an interactive shell for a PTY without changing its stdio shape. */
  pty(executable: string, args: readonly string[], cwd = this.workspaceRoot, size = DEFAULT_TERMINAL_SIZE): SandboxedProcess {
    if (this.runner === "windows-acl" && this.mode !== "danger-full-access") {
      return this.windowsProcess(executable, args, cwd, size);
    }
    return this.wrap(executable, args, cwd);
  }
}






