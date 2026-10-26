import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backendKey,
  backendRegistrationPath,
  claimBackendRegistration,
  readBackendRegistration,
  removeBackendRegistration,
  writeBackendRegistration,
} from "../src/backend-registry.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ringko-backends-"));
  const env = { RINGKO_HOME: root } as NodeJS.ProcessEnv;
  const workspace = join(root, "project");
  mkdirSync(workspace);
  const input = {
    workspace,
    configPath: null,
    url: "http://127.0.0.1:23456",
    port: 23_456,
    pid: process.pid,
    instance: "instance-a",
    startedAt: Date.now(),
  };
  return { root, env, workspace, input };
}

it("round-trips a live owner and separates workspace/config keys", () => {
  const { root, env, workspace, input } = fixture();
  try {
    const path = writeBackendRegistration(input, env);
    expect(path).toBe(backendRegistrationPath(workspace, undefined, env));
    expect(readBackendRegistration(workspace, undefined, env)).toMatchObject({ workspace: realpathSync(workspace), url: input.url, instance: "instance-a" });
    expect(backendKey(workspace, join(root, "a.json"))).not.toBe(backendKey(workspace, join(root, "b.json")));
    expect(readBackendRegistration(workspace, join(root, "a.json"), env)).toBeUndefined();
    expect(removeBackendRegistration(workspace, undefined, "instance-a", env)).toBe(true);
    expect(readBackendRegistration(workspace, undefined, env)).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("reclaims dead PIDs and never overwrites a live foreign owner", () => {
  const { root, env, workspace, input } = fixture();
  try {
    writeBackendRegistration({ ...input, pid: 2_147_483_647, instance: "dead" }, env);
    expect(readBackendRegistration(workspace, undefined, env)).toBeUndefined();
    expect(claimBackendRegistration({ ...input, instance: "first" }, env).status).toBe("claimed");
    const conflict = claimBackendRegistration({ ...input, instance: "second" }, env);
    expect(conflict.status).toBe("conflict");
    if (conflict.status === "conflict") expect(conflict.registration.instance).toBe("first");
    expect(readBackendRegistration(workspace, undefined, env)?.instance).toBe("first");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("rejects malformed or foreign registrations instead of trusting them", () => {
  const { root, env, workspace, input } = fixture();
  try {
    const path = writeBackendRegistration(input, env);
    writeFileSync(path, "{broken");
    expect(readBackendRegistration(workspace, undefined, env)).toBeUndefined();
    // Place a valid-shaped record for a different workspace directly.
    writeFileSync(path, JSON.stringify({ ...input, workspace: join(root, "other") }));
    expect(readBackendRegistration(workspace, undefined, env)).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("refuses to write an invalid registration", () => {
  const { root, env, workspace, input } = fixture();
  try {
    for (const patch of [
      { url: "https://127.0.0.1:23456" },
      { url: "http://user:secret@127.0.0.1:23456" },
      { port: 0 },
      { pid: 0 },
      { instance: "" },
    ]) {
      expect(() => writeBackendRegistration({ ...input, ...patch }, env)).toThrow();
    }
    expect(readBackendRegistration(workspace, undefined, env)).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
