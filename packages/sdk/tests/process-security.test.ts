import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolRegistry } from "@ringko-ai/harness";
import { externalProcessEnvironment } from "@ringko-ai/tools";
import { CommandProvider } from "../src/subagents/providers/command.ts";
import { SUBAGENT_PROCESS_LIMITS as LIMITS } from "../src/subagents/providers/process-limits.ts";

let root: string, previous: string | undefined;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "rkh-process-security-")); previous = process.env.RKH_REVIEW_CREDENTIAL; process.env.RKH_REVIEW_CREDENTIAL = "dummy-sensitive-value"; });
afterEach(() => { if (previous === undefined) delete process.env.RKH_REVIEW_CREDENTIAL; else process.env.RKH_REVIEW_CREDENTIAL = previous; rmSync(root, { recursive: true, force: true }); });
const context = (root: string) => ({ workspace: root, tools: new ToolRegistry(), model: async () => ({ content: "", toolCalls: [] }) });
async function run(script: string, options: Partial<ConstructorParameters<typeof CommandProvider>[0]> = {}) {
  const provider = new CommandProvider({ name: "fixture", command: process.execPath, args: ["-e", script], shell: false, ...options });
  const child = await provider.start({ description: "fixture", prompt: "fixture", mode: "read", cwd: root }, context(root));
  try { return await child.result; } finally { await child.dispose(); }
}

it("omits arbitrary ambient credentials and preserves explicitly authorized credentials", async () => {
  const script = "console.log(JSON.stringify({secret:process.env.RKH_REVIEW_CREDENTIAL??null,explicit:process.env.EXPLICIT_REVIEW_KEY??null,path:Boolean(process.env.PATH||process.env.Path)}))";
  const omitted = await run(script, { env: { EXPLICIT_REVIEW_KEY: "explicit-fixture" } });
  expect(JSON.parse(omitted.content)).toEqual({ secret: null, explicit: "explicit-fixture", path: true });
  const inherited = await run(script, { inheritEnv: ["RKH_REVIEW_CREDENTIAL"] });
  expect(JSON.parse(inherited.content).secret).toBe("dummy-sensitive-value");
});

it("rejects loader overrides and missing explicitly inherited values without revealing values", () => {
  expect(() => externalProcessEnvironment({ NODE_OPTIONS: "--inspect" })).toThrow("Invalid explicit");
  expect(() => externalProcessEnvironment({}, ["RKH_MISSING_REVIEW_VARIABLE"])).toThrow("is missing");
});

it("fails giant lines, cumulative stdout and stderr instead of returning truncated success", async () => {
  const line = await run(`console.log('x'.repeat(${LIMITS.lineBytes + 1}))`);
  expect(line.status).toBe("failed"); expect(line.diagnostic).toContain("line exceeded");
  const total = await run("for(let i=0;i<120;i++) console.log('x'.repeat(20000))");
  expect(total.status).toBe("failed"); expect(total.diagnostic).toContain("stdout exceeded");
  const stderr = await run(`process.stderr.write('x'.repeat(${LIMITS.stderrBytes + 1}));setInterval(()=>{},1000)`);
  expect(stderr.status).toBe("failed"); expect(stderr.diagnostic).toContain("stderr exceeded");
}, 30_000);

it("settles a timed-out process and reports spawn failures without unhandled rejections", async () => {
  const timeout = await run("setInterval(()=>{},1000)", { timeoutMs: 100 });
  expect(timeout.status).toBe("failed"); expect(timeout.diagnostic).toContain("deadline");
  const missing = await run("", { command: join(root, "missing-executable") });
  expect(missing.status).toBe("failed");
}, 30_000);

it.skipIf(process.platform !== "win32")("preserves argument boundaries through a Windows command shim", async () => {
  const script = join(root, "agent.cjs"), shim = join(root, "agent.cmd");
  writeFileSync(script, "process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify(process.argv.slice(2))));");
  writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  const cwd = join(root, "dir & data"); mkdirSync(cwd);
  const literals = ["space value", "pipe|literal", "left(parenthesis)"];
  const provider = new CommandProvider({ name: "shim", command: shim, args: ["--cwd", "{cwd}", ...literals] });
  const child = await provider.start({ description: "shim", prompt: "stdin & stays data", mode: "read", cwd }, context(root));
  try { const result = await child.result; expect(result.status).toBe("completed"); expect(JSON.parse(result.content)).toEqual(["--cwd", cwd, ...literals]); }
  finally { await child.dispose(); }
  for (const argument of ["%RKH_REVIEW_CREDENTIAL%", "quote\"&literal", "caret^", "!expansion!"]) {
    const blocked = new CommandProvider({ name: "blocked", command: shim, args: [argument] });
    const handle = await blocked.start({ description: "blocked", prompt: "fixture", mode: "read", cwd: root }, context(root));
    try { const result = await handle.result; expect(result.status).toBe("failed"); expect(result.diagnostic).toContain("command shims"); }
    finally { await handle.dispose(); }
  }
  const native = new CommandProvider({ name: "native", command: process.execPath, args: [script, "%literal%", "quote\"&literal", "caret^"] });
  const nativeChild = await native.start({ description: "native", prompt: "fixture", mode: "read", cwd: root }, context(root));
  try { const result = await nativeChild.result; expect(result.status).toBe("completed"); expect(JSON.parse(result.content)).toEqual(["%literal%", "quote\"&literal", "caret^"]); }
  finally { await nativeChild.dispose(); }
}, 30_000);
