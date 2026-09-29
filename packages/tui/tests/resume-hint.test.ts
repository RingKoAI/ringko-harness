import { expect, it } from "bun:test";
import { resumeHint } from "../src/resume-hint.ts";

it("prints a reusable Bun invocation for source launches", () => {
  const text = resumeHint("session-one", "C:\\Work Dir", "C:\\RingKo\\cli.ts", true);
  expect(text).toContain("Resume this session with:");
  expect(text).toContain("bun 'C:\\RingKo\\cli.ts' tui --session 'session-one' --workspace 'C:\\Work Dir'");
});

it("quotes shell metacharacters without executing them", () => {
  expect(resumeHint("session-one", "C:\\O'Brien $work", undefined, true)).toContain("'C:\\O''Brien $work'");
  expect(resumeHint("session-one", "/O'Brien $(work)", undefined, false)).toContain("'/O'\"'\"'Brien $(work)'");
});

it("uses the binary command for compiled launches", () => {
  expect(resumeHint("session-one", "/work", "$bunfs/root/cli.ts", false)).toContain("ringko tui --session 'session-one'");
});
