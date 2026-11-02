import { existsSync } from "node:fs";
import { join } from "node:path";

export type ShellKind = "git-bash" | "cmd" | "posix";

export interface ShellInvocation {
  executable: string;
  args: string[];
  kind: ShellKind;
}

export interface ShellPreference {
  /**
   * Prefer Git Bash when present. The Windows restricted-token sandbox cannot
   * host the MSYS runtime (it is denied its BaseNamedObjects shared memory),
   * so sandboxed calls pass false and use cmd.exe instead.
   */
  preferGitBash?: boolean;
}

/** Explicit Git Bash path; an invalid value fails closed instead of silently falling back. */
export const GIT_BASH_PATH_ENV = "RINGKO_GIT_BASH_PATH";

const GIT_BASH_INSTALL = ["Git", "bin", "bash.exe"] as const;

/**
 * Locate Git Bash on Windows. Known Git for Windows install roots are checked
 * before PATH so a workspace-local `bash.exe` cannot be picked up implicitly.
 */
export function findGitBash(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const override = env[GIT_BASH_PATH_ENV]?.trim();
  if (override) {
    if (!exists(override)) throw new Error(`${GIT_BASH_PATH_ENV} does not point to an existing file: ${override}`);
    return override;
  }
  const roots = [
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.ProgramW6432,
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs") : undefined,
  ];
  for (const root of roots) {
    if (!root) continue;
    const candidate = join(root, ...GIT_BASH_INSTALL);
    if (exists(candidate)) return candidate;
  }
  return undefined;
}

/** Build the non-interactive invocation for one command. */
export function shellCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  preference: ShellPreference = {},
): ShellInvocation {
  if (platform === "win32") {
    if (preference.preferGitBash !== false) {
      const bash = findGitBash(env);
      if (bash) return { executable: bash, args: ["--noprofile", "--norc", "-c", command], kind: "git-bash" };
    }
    return { executable: env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", command], kind: "cmd" };
  }
  return { executable: "/bin/sh", args: ["-c", command], kind: "posix" };
}

/** Build the interactive invocation used by the WebUI terminal. */
export function interactiveShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  preference: ShellPreference = {},
): ShellInvocation {
  if (platform === "win32") {
    if (preference.preferGitBash !== false) {
      const bash = findGitBash(env);
      if (bash) return { executable: bash, args: ["--noprofile", "--norc", "-i"], kind: "git-bash" };
    }
    const shell = env.ComSpec ?? "powershell.exe";
    return { executable: shell, args: /powershell/i.test(shell) ? ["-NoLogo", "-NoExit"] : [], kind: "cmd" };
  }
  return { executable: env.SHELL ?? "/bin/bash", args: ["-i"], kind: "posix" };
}
