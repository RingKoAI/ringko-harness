import { expect, it } from "bun:test";
import { applyPermissionPreset, isPermissionPreset, permissionPresetFor } from "../src/permission-presets.ts";

it("switches approval and sandbox together without changing unrelated host capabilities", () => {
  const original = { permission: "assist", workspace: "project", sandbox: { additionalWritableRoots: ["extra"], mcp: { fixture: { url: "https://example.invalid" } } }, capabilities: { shell: false } };
  for (const [preset, permission, sandbox] of [["read-only", "approval", "read-only"], ["default", "approval", "workspace-write"], ["full-access", "full", "danger-full-access"]] as const) {
    const next = applyPermissionPreset(original, preset);
    expect(next.permission).toBe(permission); expect(next.mode).toBe(permission); expect(next.sandbox?.mode).toBe(sandbox);
    expect(next.sandbox?.additionalWritableRoots).toEqual(["extra"]); expect(next.capabilities).toEqual({ shell: false });
    expect(permissionPresetFor(next)).toBe(preset);
  }
  expect(original.permission).toBe("assist"); expect(original.sandbox).not.toHaveProperty("mode");
});

it("derives effective state from actual knobs and rejects fake or prototype preset names", () => {
  expect(permissionPresetFor({})).toBe("default");
  expect(permissionPresetFor({ permission: "full" })).toBe("custom");
  expect(permissionPresetFor({ permissionPreset: "full-access", permission: "approval", sandbox: { mode: "read-only" } })).toBe("read-only");
  for (const value of [null, "custom", "__proto__", "constructor", "full"]) {
    expect(isPermissionPreset(value)).toBe(false);
    expect(() => applyPermissionPreset({}, value as "default")).toThrow("Invalid permission preset");
  }
});
