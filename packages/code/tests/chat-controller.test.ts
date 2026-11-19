import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIENT_LIFECYCLE_VERSION, PROTOCOL_VERSION, type Approval, type SessionSnapshot } from "@ringko-ai/protocol";
import { BackendManager } from "../src/backend-manager.ts";
import { ChatController, snapshotToMessages } from "../src/chat-controller.ts";

describe("snapshotToMessages", () => {
  it("pairs tool calls with results, marks mid-run steered messages, and renders partial live responses", () => {
    const snapshot: SessionSnapshot = {
      id: "sess-1",
      instance: "inst-1",
      revision: 5,
      title: "Test Session",
      summary: null,
      archived: false,
      model: "openai/gpt-5",
      busy: true,
      approvals: [],
      questions: [],
      tasks: [],
      todos: [],
      jobs: [],
      steering: [],
      loop: null,
      error: null,
      messages: [
        { sourceSeq: 1, role: "user", content: "First prompt\n\nAttached files (read them if relevant): /tmp/a.png" },
        {
          sourceSeq: 2,
          role: "assistant",
          content: "Checking file...",
          toolCalls: [{ id: "tc-1", name: "read", arguments: { path: "src/a.ts" } }],
        },
        { sourceSeq: 3, role: "tool", toolCallId: "tc-1", name: "read", content: "export const a = 1;" },
        { sourceSeq: 4, role: "user", content: "Also check b.ts" },
      ],
      events: [
        { seq: 0, time: 1, type: "run/started", data: { runId: "r1" } },
        { seq: 1, time: 2, type: "user/message" },
        { seq: 2, time: 3, type: "assistant/message" },
        { seq: 3, time: 4, type: "tool/result", data: { toolCallId: "tc-1", failed: false } },
        { seq: 4, time: 5, type: "user/message" },
      ],
      partial: {
        content: "Reading b.ts now...",
        reasoning: "User steered mid-run",
      },
    };

    const views = snapshotToMessages(snapshot);
    expect(views.length).toBe(4);
    expect(views[0]).toMatchObject({ role: "user", content: "First prompt" });
    expect(views[0]?.steered).toBeUndefined();

    expect(views[1]?.toolCalls?.[0]).toMatchObject({
      id: "tc-1",
      name: "read",
      resultText: "export const a = 1;",
      failed: false,
      running: false,
    });

    expect(views[2]).toMatchObject({ role: "user", content: "Also check b.ts", steered: true });
    expect(views[3]).toMatchObject({
      id: "partial-live",
      role: "assistant",
      content: "Reading b.ts now...",
      reasoning: "User steered mid-run",
      streaming: true,
    });
  });
});

describe("ChatController end-to-end flows", () => {
  const servers: Array<{ stop(closeActiveConnections?: boolean): void }> = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const srv of servers.splice(0)) srv.stop(true);
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("uploads base64 images via multipart, streams chat SSE, handles mid-run steering & approvals, and drains queued prompts", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "rkh-code-cc-"));
    tempDirs.push(workspace);

    const instance = randomUUID();
    const sessionId = "sess-live";
    const uploadedNames: string[] = [];
    const receivedChats: Array<{ prompt: string; attachments?: string[] }> = [];
    const receivedSteers: Array<{ id?: string; prompt: string }> = [];
    const receivedApprovals: Array<{ id: string; approved: boolean; scope?: string }> = [];

    let releaseFirstChat!: () => void;
    const firstChatGate = new Promise<void>(resolve => {
      releaseFirstChat = resolve;
    });

    let firstChatEntered!: () => void;
    const firstChatStarted = new Promise<void>(resolve => {
      firstChatEntered = resolve;
    });

    let busy = false;
    const recordedMessages: SessionSnapshot["messages"] = [];
    const recordedEvents: SessionSnapshot["events"] = [];

    const encoder = new TextEncoder();
    const sse = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/backend") {
          return Response.json({
            protocol: PROTOCOL_VERSION,
            instance,
            workspace,
            configPath: null,
            lifecycle: { version: CLIENT_LIFECYCLE_VERSION, managed: true, clients: 1, cli: 0, web: 0, ide: 1, webui: false },
          });
        }
        if (url.pathname === "/api/backend/clients" && req.method === "POST") {
          return Response.json({ id: randomUUID(), instance, heartbeatMs: 10_000, ttlMs: 30_000 });
        }
        if (url.pathname.startsWith("/api/backend/clients/") && req.method === "DELETE") {
          return Response.json({ ok: true });
        }
        if (url.pathname === "/api/info") {
          return Response.json({
            modelId: "openai/gpt-5",
            permissionPreset: "default",
            busyEnter: "queue",
            providers: [{ name: "openai", type: "openai", models: ["gpt-5", "gpt-5-mini"] }],
          });
        }
        if (url.pathname === "/api/sessions" && req.method === "GET") {
          return Response.json([{ id: sessionId, createdAt: 100, cwd: workspace, title: "IDE Test", busy }]);
        }
        if (url.pathname === `/api/sessions/${sessionId}/snapshot`) {
          return Response.json({
            id: sessionId,
            instance,
            revision: recordedEvents.length,
            title: "IDE Test",
            summary: null,
            archived: false,
            model: "openai/gpt-5",
            messages: recordedMessages,
            events: recordedEvents,
            busy,
            approvals: [],
            questions: [],
            tasks: [],
            todos: [],
            jobs: [],
            steering: [],
            partial: null,
            loop: null,
            error: null,
          } satisfies SessionSnapshot);
        }
        if (url.pathname === "/api/sync") {
          const stream = new ReadableStream<Uint8Array>({
            start(ctrl) {
              req.signal.addEventListener("abort", () => {
                try { ctrl.close(); } catch { /* closed */ }
              }, { once: true });
            },
          });
          return new Response(stream, { headers: { "content-type": "text/event-stream" } });
        }
        if (url.pathname === "/api/upload" && req.method === "POST") {
          const form = await req.formData();
          const files = form.getAll("file") as File[];
          const saved = files.map(f => {
            uploadedNames.push(f.name);
            return { name: f.name, path: `${workspace}/.ringko/uploads/${f.name}`, size: f.size };
          });
          return Response.json({ files: saved });
        }
        if (url.pathname === `/api/sessions/${sessionId}/steer` && req.method === "POST") {
          if (!busy) return Response.json({ error: "No active run" }, { status: 409 });
          const body = await req.json() as { id?: string; prompt: string };
          receivedSteers.push(body);
          return Response.json({ ok: true, id: body.id ?? "steer-1" });
        }
        if (url.pathname === "/api/approval" && req.method === "POST") {
          const body = await req.json() as { id: string; approved: boolean; scope?: string };
          receivedApprovals.push(body);
          releaseFirstChat();
          return Response.json({ ok: true });
        }
        if (url.pathname === "/api/chat" && req.method === "POST") {
          const body = await req.json() as { prompt: string; attachments?: string[] };
          receivedChats.push(body);
          const isFirst = receivedChats.length === 1;
          busy = true;

          const stream = new ReadableStream<Uint8Array>({
            async start(ctrl) {
              ctrl.enqueue(sse("session", { sessionId }));
              ctrl.enqueue(sse("delta", { kind: "text", text: isFirst ? "First reply" : "Queued reply" }));
              if (isFirst) {
                ctrl.enqueue(
                  sse("approval", {
                    id: "ap-live-1",
                    toolName: "shell",
                    riskLevel: "medium",
                    riskKind: "shell",
                    reason: "Run test command",
                    target: "bun test",
                  } satisfies Approval),
                );
                firstChatEntered();
                await firstChatGate;
                ctrl.enqueue(sse("approval_closed", { id: "ap-live-1" }));
              }
              const seqBase = recordedEvents.length;
              recordedEvents.push({ seq: seqBase, time: Date.now(), type: "run/started", data: { runId: randomUUID() } });
              recordedMessages.push({ sourceSeq: seqBase + 1, role: "user", content: body.prompt });
              recordedEvents.push({ seq: seqBase + 1, time: Date.now(), type: "user/message" });
              recordedMessages.push({ sourceSeq: seqBase + 2, role: "assistant", content: isFirst ? "First reply" : "Queued reply" });
              recordedEvents.push({ seq: seqBase + 2, time: Date.now(), type: "assistant/message" });
              recordedEvents.push({ seq: seqBase + 3, time: Date.now(), type: "run/completed" });
              busy = false;
              ctrl.enqueue(sse("done", { sessionId, content: "ok", turns: 1 }));
              ctrl.close();
            },
          });
          return new Response(stream, { headers: { "content-type": "text/event-stream" } });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    servers.push(server);

    const manager = new BackendManager({
      workspace,
      getSettings: () => ({
        serverUrl: `http://127.0.0.1:${server.port}`,
        authToken: "",
        cliPath: "ringko",
        autoStartBackend: false,
      }),
    });

    const notifiedApprovals: Approval[] = [];
    let notifyApprovalSeen!: () => void;
    const approvalObserved = new Promise<void>(resolve => {
      notifyApprovalSeen = resolve;
    });
    const controller = new ChatController({
      backend: manager,
      locale: "zh-CN",
      onApprovalRequested: approval => {
        notifiedApprovals.push(approval);
        notifyApprovalSeen();
      },
    });

    await controller.initialize();
    expect(controller.getState().sessionId).toBe(sessionId);
    expect(controller.getState().models.map(m => m.id)).toEqual(["openai/gpt-5", "openai/gpt-5-mini"]);

    // 1. Upload pasted screenshot
    await controller.uploadFiles([
      {
        name: "pasted-image-20261118.png",
        type: "image/png",
        size: 4,
        base64: Buffer.from([137, 80, 78, 71]).toString("base64"),
      },
    ]);
    expect(uploadedNames).toEqual(["pasted-image-20261118.png"]);
    expect(controller.getState().attachments.length).toBe(1);

    // 2. Submit attachment-only turn (uses zh-CN fallback prompt)
    const firstTurnPromise = controller.sendOrEnqueue("");
    await firstChatStarted;
    await approvalObserved;

    expect(controller.getState().busy).toBe(true);
    expect(notifiedApprovals.length).toBe(1);
    expect(notifiedApprovals[0]?.id).toBe("ap-live-1");

    // 3. Steer mid-run AND enqueue a follow-up while busy
    await controller.steer("Check edge cases too");
    expect(receivedSteers.length).toBe(1);
    expect(receivedSteers[0]?.prompt).toBe("Check edge cases too");

    controller.enqueue("Follow-up after first turn");
    expect(controller.getState().queue.length).toBe(1);

    // 4. Approve pending tool -> finishes first turn AND automatically drains queued follow-up!
    await controller.decideApproval("ap-live-1", true, "session");
    await firstTurnPromise;

    expect(receivedApprovals).toEqual([{ id: "ap-live-1", approved: true, scope: "session" }]);
    expect(receivedChats.length).toBe(2);
    expect(receivedChats[0]?.prompt).toBe("请查看上传的附件。");
    expect(receivedChats[0]?.attachments?.length).toBe(1);
    expect(receivedChats[1]?.prompt).toBe("Follow-up after first turn");
    expect(controller.getState().queue.length).toBe(0);
    expect(controller.getState().busy).toBe(false);

    controller.dispose();
    await manager.dispose();
  });
});
