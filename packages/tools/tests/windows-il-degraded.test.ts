import { describe, expect, it } from "bun:test";
import { degradedGrantPaths, degradedRootsFromOutput, describeSpawnFailure, resolveWindowsPolicy, residualOwnerGrantsFromOutput } from "../src/windows-runner.ts";

const onWindows = process.platform === "win32";

type Grant = { path: string; sid: string; rights: "Modify" | "FullControl" };

const grant = (path: string, rights: "Modify" | "FullControl" = "Modify"): Grant => ({
  path, sid: "S-1-4-1-1-1", rights,
});

describe("degradedRootsFromOutput", () => {
  it("extracts every IL_DEGRADED marker line, ignoring surrounding noise", () => {
    const output = [
      "",
      "[IL_DEGRADED] C:\\Users\\me\\work",
      "some other output",
      "prefix [IL_DEGRADED] D:\\data\\app",
      "   [IL_DEGRADED]   ",
    ].join("\n");
    // The trailing marker has no path after it and must be ignored.
    expect(degradedRootsFromOutput(output)).toEqual([
      "C:\\Users\\me\\work",
      "D:\\data\\app",
    ]);
  });

  it("returns an empty list when nothing is degraded", () => {
    expect(degradedRootsFromOutput("no markers here\n")).toEqual([]);
    expect(degradedRootsFromOutput("")).toEqual([]);
  });
});

describe("degradedGrantPaths", () => {
  const grants = [grant("C:\\Users\\me\\work"), grant("D:\\data\\app")];

  it("maps raw degraded paths back to their grant paths", () => {
    const degraded = degradedGrantPaths(grants, ["C:\\Users\\me\\work", "D:\\data\\app"]);
    expect([...degraded]).toEqual(["C:\\Users\\me\\work", "D:\\data\\app"]);
  });

  it("matches paths case-insensitively on Windows", () => {
    const degraded = degradedGrantPaths(grants, ["c:\\users\\ME\\WORK"]);
    if (onWindows) {
      expect([...degraded]).toEqual(["C:\\Users\\me\\work"]);
    } else {
      // Case-sensitive filesystems do not perform case folding.
      expect(degraded.size).toBe(0);
    }
  });

  it("ignores degraded paths that are not present in the grant set", () => {
    expect(degradedGrantPaths(grants, ["Z:\\unknown"]).size).toBe(0);
  });

  it("returns an empty set when nothing is degraded", () => {
    expect(degradedGrantPaths(grants, []).size).toBe(0);
  });
});

describe("residualOwnerGrantsFromOutput", () => {
  it("extracts owner-residual markers without treating them as degraded roots", () => {
    const output = "[IL_OWNER_RESIDUAL] C:\\work\n[IL_DEGRADED] D:\\data\n";
    expect(residualOwnerGrantsFromOutput(output)).toEqual(["C:\\work"]);
    expect(degradedRootsFromOutput(output)).toEqual(["D:\\data"]);
  });
});

describe("resolveWindowsPolicy", () => {
  const workspace = "C:\\work";
  const extra = "D:\\extra";

  it("drops every writable root when the workspace itself is degraded", () => {
    expect(resolveWindowsPolicy("workspace-write", workspace, [extra], new Set([workspace]))).toEqual({
      mode: "read-only",
      writableRoots: [],
    });
  });

  it("keeps the workspace but removes only degraded additional roots", () => {
    expect(resolveWindowsPolicy("workspace-write", workspace, [extra], new Set([extra]))).toEqual({
      mode: "workspace-write",
      writableRoots: [],
    });
  });

  it("never advertises writable roots in read-only mode", () => {
    expect(resolveWindowsPolicy("read-only", workspace, [extra], new Set())).toEqual({
      mode: "read-only",
      writableRoots: [],
    });
  });

  it("keeps the requested roots when nothing is degraded", () => {
    expect(resolveWindowsPolicy("workspace-write", workspace, [extra], new Set())).toEqual({
      mode: "workspace-write",
      writableRoots: [extra],
    });
  });

  it("matches degraded roots case-insensitively on Windows", () => {
    const policy = resolveWindowsPolicy("workspace-write", workspace, [extra], new Set(["c:\\WORK"]));
    expect(policy.mode).toBe(process.platform === "win32" ? "read-only" : "workspace-write");
  });
});

describe("describeSpawnFailure", () => {
  it("includes the spawn error code when process creation fails", () => {
    const detail = describeSpawnFailure({ error: Object.assign(new Error("resource temporarily unavailable"), { code: "EAGAIN" }), status: null });
    expect(detail).toContain("spawn EAGAIN");
    expect(detail).toContain("resource temporarily unavailable");
  });

  it("includes exit status and captured stderr for a failed command", () => {
    const detail = describeSpawnFailure({ status: 5, stdout: "", stderr: "Access is denied." });
    expect(detail).toContain("exit 5");
    expect(detail).toContain("Access is denied.");
  });

  it("never returns an empty reason", () => {
    expect(describeSpawnFailure({ status: 1 })).toBe("exit 1");
    expect(describeSpawnFailure({ status: null })).toBe("no diagnostic output");
  });
});
