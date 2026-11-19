import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "@ringko-ai/session";
import { createRingKo, defineTool } from "../src/index.ts";

describe("RingKo mid-run steering", () => {
  it("persists steered user messages inside the active run and feeds them to the next model step", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rkh-sdk-steer-"));
    try {
      const store = new SessionStore({ cwd: dir, root: dir });
      const session = store.create({ cwd: dir });
      const seenPrompts: string[][] = [];
      let turnCount = 0;

      const ringko = createRingKo({
        session,
        accessMode: "full",
        model: async (request) => {
          seenPrompts.push(request.messages.filter(m => m.role === "user").map(m => m.content));
          turnCount += 1;
          if (turnCount === 1) {
            return { content: "Inspecting", toolCalls: [{ id: "call-1", name: "probe", arguments: {} }] };
          }
          return { content: "Done with BANANA", toolCalls: [] };
        },
      });

      ringko.register(defineTool({
        name: "probe",
        description: "Steer while running.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        parseInput: () => ({}),
        assessRisk: () => ({ kind: "safe", reason: "test" }),
        execute: () => {
          expect(ringko.steer("Include BANANA", { id: "steer-fixed" })).toBe(true);
          // Duplicate id is idempotent.
          expect(ringko.steer("Include BANANA", { id: "steer-fixed" })).toBe(true);
          expect(ringko.pendingSteers()).toEqual([{ id: "steer-fixed", content: "Include BANANA" }]);
          return { ok: true };
        },
      }));

      expect(ringko.steer("idle steer")).toBe(false);
      const result = await ringko.run("Initial task");
      expect(ringko.steer("post-run steer")).toBe(false);
      expect(ringko.pendingSteers()).toEqual([]);
      expect(result.content).toBe("Done with BANANA");
      expect(seenPrompts).toEqual([
        ["Initial task"],
        ["Initial task", "Include BANANA"],
      ]);

      const events = session.all();
      expect(events.filter(e => e.type === "user/message").map(e => e.data)).toEqual([
        { content: "Initial task" },
        { content: "Include BANANA", id: "steer-fixed" },
      ]);
      expect(events.filter(e => e.type.startsWith("run/")).map(e => e.type)).toEqual([
        "run/started",
        "run/completed",
      ]);
      session.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wakes an agent waiting on a background job immediately when steered", async () => {
    const jobBarrier = Promise.withResolvers<string>();
    let calls = 0;
    const ringko = createRingKo({
      accessMode: "full",
      model: async (request) => {
        calls += 1;
        if (calls === 1) {
          return { content: "", toolCalls: [{ id: "bg-1", name: "bg_work", arguments: {} }] };
        }
        if (calls === 2) {
          // Return final text while the background job is still running; RingKo now awaits nextNotifications.
          setTimeout(() => {
            ringko.steer("Answer me while bg_work is still running");
          }, 15);
          return { content: "Started background work", toolCalls: [] };
        }
        if (calls === 3) {
          expect(request.messages.at(-1)).toEqual({ role: "user", content: "Answer me while bg_work is still running" });
          jobBarrier.resolve("bg-finished");
          return { content: "Steered reply mid-background", toolCalls: [] };
        }
        return { content: "All background notifications handled", toolCalls: [] };
      },
    });

    ringko.register(defineTool({
      name: "bg_work",
      description: "Start a background job.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      parseInput: () => ({}),
      assessRisk: () => ({ kind: "safe", reason: "test" }),
      execute: (_input, context) => {
        const started = context!.jobs!.start(
          { kind: "shell", description: "slow background", background: true },
          async () => await jobBarrier.promise,
        );
        return { jobId: started.jobId };
      },
    }));

    const result = await ringko.run("Launch bg");
    expect(calls).toBe(4);
    expect(result.content).toBe("All background notifications handled");
  });

  it("retains unclaimed steered messages after streamed prefix when cancelled and includes both on the next run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rkh-sdk-cancel-steer-"));
    try {
      const store = new SessionStore({ cwd: dir, root: dir });
      const session = store.create({ cwd: dir });
      const controller = new AbortController();
      const seenUserLists: string[][] = [];
      let call = 0;

      const ringko = createRingKo({
        session,
        accessMode: "full",
        model: async (request) => {
          call += 1;
          seenUserLists.push(request.messages.filter(m => m.role === "user").map(m => m.content));
          if (call === 1) {
            request.onDelta?.({ kind: "text", text: "Partial output" });
            expect(ringko.steer("Steered before stop", { id: "retained-1" })).toBe(true);
            controller.abort();
            request.signal?.throwIfAborted();
          }
          return { content: "Resumed reply", toolCalls: [] };
        },
      });

      await expect(ringko.run("First prompt", { signal: controller.signal })).rejects.toThrow();
      const resumed = await ringko.run("Second prompt");
      expect(resumed.content).toBe("Resumed reply");
      expect(seenUserLists[1]).toEqual(["First prompt", "Steered before stop", "Second prompt"]);

      const surface = session.all().filter(e => e.type === "user/message" || e.type === "assistant/message");
      expect(surface.map(e => [e.type, (e.data as { content: string }).content])).toEqual([
        ["user/message", "First prompt"],
        ["assistant/message", "Partial output"],
        ["user/message", "Steered before stop"],
        ["user/message", "Second prompt"],
        ["assistant/message", "Resumed reply"],
      ]);
      session.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
