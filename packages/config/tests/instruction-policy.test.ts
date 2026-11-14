import { expect, it } from "bun:test";
import { INSTRUCTION_SCAN_CONFIG_LIMITS, INSTRUCTION_SCAN_DEFAULTS, instructionScanPolicy, normalizeInstructionExclude } from "../src/instruction-policy.ts";

it("uses bounded defaults and accepts explicit zero depth, a single directory and empty exclusions", () => {
  const warnings: string[] = [], warn = (message: string) => { warnings.push(message); };
  expect(instructionScanPolicy(undefined, warn)).toEqual(INSTRUCTION_SCAN_DEFAULTS);
  expect(instructionScanPolicy({ recursive: false, excludeNestedRepositories: false, maxDepth: 0, maxDirectories: 1, excludeDirectories: [] }, warn)).toEqual({ recursive: false, excludeNestedRepositories: false, maxDepth: 0, maxDirectories: 1, excludeDirectories: [] });
  expect(instructionScanPolicy({ maxDepth: 64, maxDirectories: 65_536 }, warn).maxDirectories).toBe(65_536);
  expect(warnings).toEqual([]);
});

it("falls back per malformed field with clear warnings that never echo supplied values", () => {
  for (const value of [null, [], "fixture-secret", 1, { recursive: "fixture-secret", excludeNestedRepositories: 1, maxDepth: -1, maxDirectories: Infinity, excludeDirectories: ["../outside"] }]) {
    const warnings: string[] = [];
    expect(instructionScanPolicy(value, message => { warnings.push(message); })).toEqual(INSTRUCTION_SCAN_DEFAULTS);
    expect(warnings.length).toBeGreaterThan(0); expect(warnings.join(" ")).not.toContain("fixture-secret");
  }
  for (const value of [0, -1, 1.5, NaN, INSTRUCTION_SCAN_CONFIG_LIMITS.directories + 1, "12"]) {
    expect(instructionScanPolicy({ maxDirectories: value }, () => {}).maxDirectories).toBe(INSTRUCTION_SCAN_DEFAULTS.maxDirectories);
  }
  expect(instructionScanPolicy({ maxDepth: 65, recursive: false }, () => {}).recursive).toBe(false);
  expect(instructionScanPolicy({ excludeDirectories: Array(257).fill("dir") }, () => {}).excludeDirectories).toEqual(INSTRUCTION_SCAN_DEFAULTS.excludeDirectories);
});

it("normalizes exact directory paths and rejects traversal, absolute paths, controls and wildcards", () => {
  expect(normalizeInstructionExclude(" Example\\reference/ ")).toBe("Example/reference");
  expect(instructionScanPolicy({ excludeDirectories: ["Example/reference/", "Example\\reference"] }, () => {}).excludeDirectories).toEqual(["Example/reference"]);
  for (const value of ["", " ", "/root", "C:\\root", "\\\\host\\dir", "a/../b", "./a", "a//b", "a\0b", "a\nb", "**/build", "dir?", "x".repeat(513)]) expect(normalizeInstructionExclude(value)).toBeUndefined();
});
