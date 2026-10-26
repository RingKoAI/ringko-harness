import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultProjectWorkspace, saveProjects } from "../src/projects.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ringko-default-project-"));
  const env = { RINGKO_HOME: root } as NodeJS.ProcessEnv;
  const first = join(root, "first");
  const second = join(root, "second");
  mkdirSync(first);
  mkdirSync(second);
  return { root, env, first, second };
}

it("opens the active project rather than the launch directory", () => {
  const { root, env, first, second } = fixture();
  try {
    saveProjects({ projects: [{ id: "first", name: "First", path: first }, { id: "second", name: "Second", path: second }], current: "second" }, env);
    expect(defaultProjectWorkspace(root, env)).toEqual({ path: second, source: "project" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("falls back to the first existing registered project and skips missing paths", () => {
  const { root, env, first, second } = fixture();
  try {
    saveProjects({ projects: [
      { id: "missing", name: "Missing", path: join(root, "gone") },
      { id: "first", name: "First", path: first },
      { id: "second", name: "Second", path: second },
    ], current: "missing" }, env);
    expect(defaultProjectWorkspace(root, env)).toEqual({ path: first, source: "project" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("uses the launch directory only as a bootstrap when no project is registered", () => {
  const { root, env } = fixture();
  try {
    expect(defaultProjectWorkspace(root, env)).toEqual({ path: root, source: "bootstrap" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
