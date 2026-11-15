import { afterEach, beforeEach, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectInstallation } from "../src/updates/install.ts";

let root: string, previous: string | undefined;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "rkh-npm-launcher-")); previous = process.env.RINGKO_NPM_ROOT; delete process.env.RINGKO_NPM_ROOT; });
afterEach(() => { if (previous === undefined) delete process.env.RINGKO_NPM_ROOT; else process.env.RINGKO_NPM_ROOT = previous; rmSync(root, { recursive: true, force: true }); });

function fixture(version = "1.2.3") {
  mkdirSync(join(root, "bin"));
  copyFileSync(join(import.meta.dir, "../scripts/npm-launcher.mjs"), join(root, "bin/ringko.mjs"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@ringko-ai/rkh", version }));
  const name = `@ringko-ai/rkh-${process.platform}-${process.arch}`;
  const platform = join(root, "node_modules", ...name.split("/"));
  return { name, platform, entry: join(root, "bin/ringko.mjs") };
}

it("uses a Node shebang and explains missing optional binaries instead of invoking Bun", () => {
  const { entry } = fixture();
  const node = Bun.which("node"); expect(node).toBeDefined();
  const child = Bun.spawnSync([node!, entry, "--version"], { env: { ...process.env, PATH: "" }, timeout: 10000 });
  expect(child.exitCode).toBe(1);
  expect(child.stderr.toString()).toContain("--include=optional");
  expect(readFileSync(entry, "utf8").split("\n")[0]).toBe("#!/usr/bin/env node");
});

it("rejects mixed-version platform packages before starting a child", () => {
  const { entry, platform, name } = fixture(); mkdirSync(platform, { recursive: true });
  writeFileSync(join(platform, "package.json"), JSON.stringify({ name, version: "1.2.2" }));
  const child = Bun.spawnSync([Bun.which("node")!, entry], { timeout: 10000 });
  expect(child.exitCode).toBe(1); expect(child.stderr.toString()).toContain("version mismatch");
});

it("recognizes only the exact binary belonging to an npm wrapper for updates", async () => {
  const { platform, name } = fixture(); mkdirSync(join(platform, "bin"), { recursive: true });
  const executable = join(platform, "bin", process.platform === "win32" ? "ringko.exe" : "ringko");
  writeFileSync(executable, "fixture"); writeFileSync(join(platform, "package.json"), JSON.stringify({ name, version: "1.2.3" }));
  process.env.RINGKO_NPM_ROOT = root;
  expect(await detectInstallation("/$bunfs/root/main.js", executable)).toEqual({ kind: "npm", packageRoot: await realpath(root) });
  await expect(detectInstallation("/$bunfs/root/main.js", process.execPath)).rejects.toThrow("Cannot verify");
  writeFileSync(join(platform, "package.json"), JSON.stringify({ name, version: "other" }));
  await expect(detectInstallation("/$bunfs/root/main.js", executable)).rejects.toThrow("Cannot verify");
});
