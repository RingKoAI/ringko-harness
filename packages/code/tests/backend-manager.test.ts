import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIENT_LIFECYCLE_VERSION, PROTOCOL_VERSION } from "@ringko-ai/protocol";
import { BackendManager, validateLoopbackOrigin } from "../src/backend-manager.ts";

describe("BackendManager", () => {
  const servers: Array<{ stop(closeActiveConnections?: boolean): void }> = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const srv of servers.splice(0)) srv.stop(true);
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("enforces loopback HTTP origins on explicit serverUrl", () => {
    expect(validateLoopbackOrigin("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(validateLoopbackOrigin("http://localhost:24500/")).toBe("http://localhost:24500");
    expect(validateLoopbackOrigin("http://[::1]:8787")).toBe("http://[::1]:8787");

    expect(() => validateLoopbackOrigin("https://127.0.0.1:8787")).toThrow("loopback HTTP");
    expect(() => validateLoopbackOrigin("http://192.168.1.20:8787")).toThrow("loopback HTTP");
    expect(() => validateLoopbackOrigin("http://user:secret@127.0.0.1:8787")).toThrow("loopback HTTP");
    expect(() => validateLoopbackOrigin("http://127.0.0.1:8787/subpath")).toThrow("loopback HTTP");
  });

  it("attaches an 'ide' lease, opens a 'web' lease on demand, and releases both on dispose", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "rkh-code-bm-"));
    tempDirs.push(workspace);

    const instance = randomUUID();
    const activeLeases = new Map<string, string>();
    const deletedLeases: string[] = [];

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/backend" && req.method === "GET") {
          let cli = 0, web = 0, ide = 0;
          for (const kind of activeLeases.values()) {
            if (kind === "cli") cli++;
            else if (kind === "web") web++;
            else if (kind === "ide") ide++;
          }
          return Response.json({
            protocol: PROTOCOL_VERSION,
            instance,
            workspace,
            configPath: null,
            lifecycle: {
              version: CLIENT_LIFECYCLE_VERSION,
              managed: true,
              clients: activeLeases.size,
              cli,
              web,
              ide,
              webui: web > 0,
            },
          });
        }
        if (url.pathname === "/api/backend/clients" && req.method === "POST") {
          const body = await req.json() as { kind: string };
          const id = randomUUID();
          activeLeases.set(id, body.kind);
          return Response.json({
            id,
            instance,
            heartbeatMs: 5_000,
            ttlMs: 15_000,
          });
        }
        if (url.pathname.startsWith("/api/backend/clients/") && req.method === "DELETE") {
          const id = url.pathname.slice("/api/backend/clients/".length);
          activeLeases.delete(id);
          deletedLeases.push(id);
          return Response.json({ ok: true });
        }
        if (url.pathname === "/api/status" && req.method === "GET") {
          return Response.json({ version: "0.8.3", entries: [{ label: "cwd", value: workspace }] });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    servers.push(server);

    const origin = `http://127.0.0.1:${server.port}`;
    const manager = new BackendManager({
      workspace,
      getSettings: () => ({
        serverUrl: origin,
        authToken: "",
        cliPath: "ringko",
        autoStartBackend: false,
      }),
    });

    await manager.connect();
    expect(manager.getStatus()).toMatchObject({ state: "connected", url: origin, error: null });
    expect([...activeLeases.values()]).toEqual(["ide"]);

    const webUrl = await manager.ensureWebUiUrl();
    expect(webUrl).toBe(origin);
    expect([...activeLeases.values()].sort()).toEqual(["ide", "web"]);

    const runtime = await manager.fetchRuntimeStatus();
    expect(runtime.version).toBe("0.8.3");

    await manager.dispose();
    expect(activeLeases.size).toBe(0);
    expect(deletedLeases.length).toBe(2);
  });

  it("rejects a backend bound to a different workspace", async () => {
    const workspaceA = mkdtempSync(join(tmpdir(), "rkh-code-wsA-"));
    const workspaceB = mkdtempSync(join(tmpdir(), "rkh-code-wsB-"));
    tempDirs.push(workspaceA, workspaceB);

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.json({
          protocol: PROTOCOL_VERSION,
          instance: randomUUID(),
          workspace: workspaceB,
          configPath: null,
          lifecycle: { version: CLIENT_LIFECYCLE_VERSION, managed: true, clients: 0, cli: 0, web: 0, ide: 0, webui: false },
        });
      },
    });
    servers.push(server);

    const manager = new BackendManager({
      workspace: workspaceA,
      getSettings: () => ({
        serverUrl: `http://127.0.0.1:${server.port}`,
        authToken: "",
        cliPath: "ringko",
        autoStartBackend: false,
      }),
    });

    await expect(manager.connect()).rejects.toThrow("different RingKo workspace");
    expect(manager.getStatus().state).toBe("error");
    await manager.dispose();
  });
});
