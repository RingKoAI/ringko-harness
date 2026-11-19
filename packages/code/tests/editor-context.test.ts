import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatDiagnosticsPrompt,
  formatFileMention,
  formatSelectionPrompt,
  normalizeRelativePath,
  parseFileReference,
  resolveWorkspaceFile,
} from "../src/editor-context.ts";
import { IDE_LIMITS } from "../src/limits.ts";
import { buildChatWebviewHtml, resolveIdeLocale } from "../src/webview-html.ts";
import { parseWebviewMessage } from "../src/webview-protocol.ts";

describe("editor-context helpers", () => {
  it("normalizes relative workspace paths and rejects paths outside workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "rkh-code-ctx-"));
    try {
      const sub = join(root, "src", "nested");
      mkdirSync(sub, { recursive: true });
      const file = join(sub, "index.ts");
      writeFileSync(file, "export const x = 1;\n");

      expect(normalizeRelativePath(root, file)).toBe("src/nested/index.ts");
      expect(normalizeRelativePath(root, root)).toBeNull();
      expect(normalizeRelativePath(root, join(root, "..", "outside.ts"))).toBeNull();
      expect(normalizeRelativePath(root, "bad\0path.ts")).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("formats @file mentions with line ranges and quotes paths containing spaces", () => {
    expect(formatFileMention("src/app.ts")).toBe("@src/app.ts");
    expect(formatFileMention("src\\app.ts", { startLine: 10, endLine: 10 })).toBe("@src/app.ts#L10");
    expect(formatFileMention("src/app.ts", { startLine: 10, endLine: 25 })).toBe("@src/app.ts#L10-L25");
    expect(formatFileMention("src/my file.ts", { startLine: 3, endLine: 7 })).toBe('@"src/my file.ts#L3-L7"');
  });

  it("formats bounded selection and diagnostics prompts in English and Chinese", () => {
    const huge = "x".repeat(IDE_LIMITS.maxSelectionChars + 500);
    const explain = formatSelectionPrompt(
      "explain",
      "src/main.ts",
      { startLine: 1, endLine: 20, text: huge, languageId: "typescript" },
      "zh-CN",
    );
    expect(explain).toContain("@src/main.ts#L1-L20");
    expect(explain).toContain("```typescript");
    expect(explain).toContain("/* ... truncated ... */");

    const manyDiagnostics = Array.from({ length: 55 }, (_, index) => ({
      line: index + 1,
      column: 2,
      severity: "error" as const,
      source: "ts",
      code: 2322,
      message: `Type mismatch on line ${index + 1}`,
    }));
    const fixPrompt = formatDiagnosticsPrompt("src/main.ts", manyDiagnostics, "en");
    expect(fixPrompt).toContain("1. L1:2 [ERROR ts(2322)] Type mismatch on line 1");
    expect(fixPrompt).toContain("50. L50:2");
    expect(fixPrompt).toContain("(5 additional diagnostics omitted)");
  });

  it("parses valid relative file references and blocks path traversal / schemes / absolute paths", () => {
    expect(parseFileReference("@src/foo.ts#L12-L24")).toEqual({
      relativePath: "src/foo.ts",
      line: 12,
      endLine: 24,
    });
    expect(parseFileReference('@"dir with space/bar.ts#L8"')).toEqual({
      relativePath: "dir with space/bar.ts",
      line: 8,
    });
    expect(parseFileReference("packages/code/src/extension.ts:42:7")).toEqual({
      relativePath: "packages/code/src/extension.ts",
      line: 42,
      column: 7,
    });

    expect(parseFileReference("../secret.txt")).toBeNull();
    expect(parseFileReference("src/../../etc/passwd")).toBeNull();
    expect(parseFileReference("%2e%2e%2fsecret.txt")).toBeNull();
    expect(parseFileReference("/etc/passwd")).toBeNull();
    expect(parseFileReference("C:\\Windows\\System32\\cmd.exe")).toBeNull();
    expect(parseFileReference("file:///etc/passwd")).toBeNull();
    expect(parseFileReference("https://evil.invalid/a.ts")).toBeNull();
    expect(parseFileReference("src/bad\0file.ts")).toBeNull();
  });

  it("verifies canonical filesystem containment in resolveWorkspaceFile", () => {
    const root = mkdtempSync(join(tmpdir(), "rkh-code-resolve-"));
    try {
      mkdirSync(join(root, "src"), { recursive: true });
      const target = join(root, "src", "hello.ts");
      writeFileSync(target, "console.log('ok');\n");

      const resolved = resolveWorkspaceFile(root, "@src/hello.ts#L1");
      expect(resolved).not.toBeNull();
      expect(resolved?.relativePath).toBe("src/hello.ts");
      expect(resolved?.line).toBe(1);

      expect(resolveWorkspaceFile(root, "src")).toBeNull();
      expect(resolveWorkspaceFile(root, "src/missing.ts")).toBeNull();
      expect(resolveWorkspaceFile(root, "../outside.ts")).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("webview-protocol & webview-html security invariants", () => {
  it("validates well-formed webview IPC messages and rejects malformed payloads", () => {
    expect(parseWebviewMessage({ type: "ready" })).toEqual({ type: "ready" });
    expect(parseWebviewMessage({ type: "steer", prompt: "use vitest instead" })).toEqual({
      type: "steer",
      prompt: "use vitest instead",
    });
    expect(parseWebviewMessage({ type: "decideApproval", id: "ap-1", approved: true, scope: "session" })).toEqual({
      type: "decideApproval",
      id: "ap-1",
      approved: true,
      scope: "session",
    });
    expect(
      parseWebviewMessage({
        type: "uploadFiles",
        files: [{ name: "shot.png", type: "image/png", size: 4, base64: "AQIDBA==" }],
      }),
    ).toEqual({
      type: "uploadFiles",
      files: [{ name: "shot.png", type: "image/png", size: 4, base64: "AQIDBA==" }],
    });

    expect(parseWebviewMessage(null)).toBeNull();
    expect(parseWebviewMessage({ type: "unknownCommand" })).toBeNull();
    expect(parseWebviewMessage({ type: "send", prompt: "x".repeat(IDE_LIMITS.maxPromptChars + 1) })).toBeNull();
    expect(parseWebviewMessage({ type: "decideApproval", id: "ap-1", approved: true, scope: "root" })).toBeNull();
    expect(
      parseWebviewMessage({
        type: "uploadFiles",
        files: [{ name: "bad.bin", type: "application/octet-stream", size: 10, base64: "not valid base64!!!" }],
      }),
    ).toBeNull();
    expect(parseWebviewMessage({ type: "selectSession", sessionId: "bad\0id" })).toBeNull();
  });

  it("renders strict nonce-protected CSP HTML without unsafe-inline or unsafe-eval", () => {
    expect(resolveIdeLocale("zh-cn")).toBe("zh-CN");
    expect(resolveIdeLocale("en-US")).toBe("en");

    const html = buildChatWebviewHtml({ locale: "zh-CN", nonce: "testNonce123==" });
    expect(html).toContain("default-src 'none'; img-src data:; style-src 'nonce-testNonce123=='; script-src 'nonce-testNonce123==';");
    expect(html).not.toContain("unsafe-inline");
    expect(html).not.toContain("unsafe-eval");
    expect(html).toContain("模型回复");
    expect(html).toContain("插话发送");

    const scriptMatch = html.match(/<script nonce="testNonce123==">([\s\S]*?)<\/script>/);
    expect(scriptMatch).not.toBeNull();
    expect(() => new Function(scriptMatch![1]!)).not.toThrow();
  });
});
