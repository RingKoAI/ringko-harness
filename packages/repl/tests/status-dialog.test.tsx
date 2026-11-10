import { expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { StatusDialog } from "../src/components/StatusDialog.tsx";
import { Repl } from "../src/app.tsx";
import { BackendClient, type RuntimeStatus } from "@ringko-ai/client";
import { render } from "./render.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statisticsFixture } from "./stats-fixture.ts";

function terminal(columns = 100, rows = 30) {
  const input = new PassThrough(), output = new PassThrough();
  Object.assign(input, { isTTY: true, setRawMode: () => input, ref: () => input, unref: () => input });
  Object.assign(output, { columns, rows, isTTY: true });
  let text = ""; output.on("data", chunk => { text += chunk.toString(); });
  return { input, output, read: () => text, reset: () => { text = ""; }, options: { stdin: input as unknown as NodeJS.ReadStream, stdout: output as unknown as NodeJS.WriteStream, stderr: output as unknown as NodeJS.WriteStream, exitOnCtrlC: false } };
}
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await Bun.sleep(20);
  expect(predicate()).toBe(true);
}
const report = (value: string): RuntimeStatus => ({ version: "1.2.3", entries: [{ label: "Model", value }] });

it("settles an unresponsive status loader and ignores its late result", async () => {
  const io = terminal();
  const pending = Promise.withResolvers<RuntimeStatus>();
  let signal: AbortSignal | undefined;
  const app = render(<StatusDialog load={current => { signal = current; return pending.promise; }} session={{}} columns={99} height={28} onClose={() => {}} onMcp={() => {}} />, io.options);
  try {
    await waitFor(() => io.read().includes("Cannot load status"), 15_000);
    expect(signal?.aborted).toBe(true);
    io.reset(); pending.resolve(report("Too late")); await Bun.sleep(80);
    expect(io.read()).not.toContain("Too late");
  } finally { pending.resolve(report("settled")); app.unmount(); io.input.destroy(); io.output.destroy(); }
}, 20_000);

it("refreshes status, ignores stale completions and aborts requests on dismissal", async () => {
  const io = terminal();
  const requests: { pending: ReturnType<typeof Promise.withResolvers<RuntimeStatus>>; signal: AbortSignal }[] = [];
  const app = render(<StatusDialog load={signal => { const pending = Promise.withResolvers<RuntimeStatus>(); requests.push({ pending, signal }); return pending.promise; }} session={{}} columns={99} height={28} onClose={() => app.unmount()} onMcp={() => {}} />, io.options);
  try {
    await waitFor(() => requests.length === 1);
    io.input.write("r"); await waitFor(() => requests.length === 2);
    expect(requests[0]!.signal.aborted).toBe(true);
    requests[1]!.pending.resolve(report("Newest status")); await waitFor(() => io.read().includes("Newest status"));
    io.reset(); requests[0]!.pending.resolve(report("Stale status")); await Bun.sleep(80);
    expect(io.read()).not.toContain("Stale status");
    io.input.write("r"); await waitFor(() => requests.length === 3);
    io.input.write("\x1b"); await waitFor(() => requests[2]!.signal.aborted);
    io.reset(); requests[2]!.pending.resolve(report("Reopened status")); await Bun.sleep(80);
    expect(io.read()).not.toContain("Reopened status");
  } finally { app.unmount(); for (const request of requests) request.pending.resolve(report("settled")); io.input.destroy(); io.output.destroy(); }
});

it("recovers from load errors, pages short screens and opens the MCP view", async () => {
  const io = terminal(40, 12); let attempts = 0, mcp = 0;
  const app = render(<StatusDialog load={async () => { if (++attempts === 1) throw new Error("private-loader-secret"); return { version: null, entries: Array.from({ length: 20 }, (_, index) => ({ label: `Field ${index}`, value: `Value ${index}` })) }; }} session={{}} columns={39} height={10} onClose={() => {}} onMcp={() => { mcp++; }} />, io.options);
  try {
    await waitFor(() => io.read().includes("Cannot load status"));
    expect(io.read()).not.toContain("private-loader-secret");
    io.input.write("r"); await waitFor(() => io.read().includes("Version:"));
    io.input.write("\x1b[F"); await waitFor(() => io.read().includes("Value 19"));
    io.reset(); io.input.write("\x1b[H"); await waitFor(() => io.read().includes("Version:"));
    io.input.write("m"); await waitFor(() => mcp === 1);
  } finally { app.unmount(); io.input.destroy(); io.output.destroy(); }
});

it("opens /status without model execution or session creation and returns to input on Esc", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-repl-status-")), io = terminal(100, 40);
  let modelCalls = 0, creates = 0, reads = 0;
  const backend = new BackendClient({ fetch: async (url, init) => {
    if (String(url).startsWith("/api/usage?")) return Response.json(statisticsFixture());
    if (String(url) === "/api/status") { reads++; return Response.json(report("Actual backend model")); }
    if (String(url) === "/api/sessions" && init?.method === "POST") creates++;
    return Response.json({ tools: [], providers: [] });
  } });
  const app = render(<Repl workspace={root} backend={backend} backendUrl="http://127.0.0.1:8787" version="1.2.4" model={async () => { modelCalls++; return { content: "", toolCalls: [] }; }} modelLabel="Fixture" config={{}} />, io.options);
  try {
    await Bun.sleep(80); io.input.write("/status"); await Bun.sleep(60); io.input.write("\r");
    await waitFor(() => io.read().includes("Favorite model:")); expect(io.read()).toContain("❯ /status"); io.input.write("\t");
    await waitFor(() => io.read().includes("Actual backend model"));
    expect(io.read()).toContain("(not started)"); expect(io.read()).toContain("1.2.4"); expect(io.read()).toContain("Backend version:");
    io.input.write("r"); await waitFor(() => reads === 2);
    io.reset(); io.input.write("\x1b"); await waitFor(() => io.read().includes("Message, /command"));
    expect(modelCalls).toBe(0); expect(creates).toBe(0);
  } finally { app.unmount(); io.input.destroy(); io.output.destroy(); rmSync(root, { recursive: true, force: true }); }
});
