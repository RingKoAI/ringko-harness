import { expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

it.skipIf(process.platform !== "win32")("builds the native runner from an isolated standalone binary without source sidecars", () => {
  const temporary = mkdtempSync(join(tmpdir(), "ringko-relocated-sandbox-"));
  try {
    const workspace = join(temporary, "workspace-验证");
    const home = join(temporary, "home");
    mkdirSync(workspace); mkdirSync(home);
    const binary = join(temporary, "sandbox-probe.exe");
    const build = spawnSync(process.execPath, ["build", join(import.meta.dir, "fixtures", "sandbox-binary.ts"), "--compile", `--outfile=${binary}`], { cwd: temporary, encoding: "utf8", timeout: 60_000 });
    expect({ status: build.status, stderr: build.stderr }).toMatchObject({ status: 0 });
    // ACL preparation owns a 120s budget; leave headroom for a cold Windows
    // PowerShell profile and the DACL helper compilation to report that result.
    const execution = spawnSync(binary, [workspace], { cwd: temporary, encoding: "utf8", env: { ...process.env, RINGKO_HOME: home }, timeout: 150_000 });
    expect({ status: execution.status, stderr: execution.stderr }).toMatchObject({ status: 0 });
    expect(existsSync(join(workspace, "relocated.txt"))).toBe(true);
  } finally { rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}, 90_000);
