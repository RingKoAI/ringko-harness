import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server.ts";

function headers(): Record<string, string> {
  return { "content-type": "application/json" };
}

it("installs skills and exposes the trusted plugin inventory over the API", async () => {
  const root = mkdtempSync(join(tmpdir(), "rkh-skills-api-"));
  const home = join(root, "home");
  const previousHome = process.env.RINGKO_HOME;
  const previousAgents = process.env.AGENTS_HOME;
  process.env.RINGKO_HOME = home;
  process.env.AGENTS_HOME = home;
  mkdirSync(join(root, ".git"));
  mkdirSync(join(home, ".ringko"), { recursive: true });
  writeFileSync(join(home, ".ringko", "settings.local.json"), JSON.stringify({ plugins: { trusted: [] } }));
  const source = join(root, "source-skill");
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "SKILL.md"), "---\nname: api-skill\ndescription: Installed through the API\n---\nBody");
  const plugin = join(root, ".ringko", "plugins", "demo");
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(plugin, "plugin.json"), JSON.stringify({ name: "demo", description: "Demo plugin", commands: [{ name: "demo-command", prompt: "Run $ARGUMENTS" }] }));
  const second = join(root, ".ringko", "plugins", "second");
  mkdirSync(second, { recursive: true });
  writeFileSync(join(second, "plugin.json"), JSON.stringify({ name: "second" }));

  const app = startServer({ workspace: root, port: 0 });
  try {
    const installed = await fetch(`${app.url}/api/skills/install`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ source, scope: "global" }),
    });
    expect(installed.status).toBe(200);
    const skills = await installed.json() as Array<{ name: string; scope: string }>;
    expect(skills).toContainEqual(expect.objectContaining({ name: "api-skill", scope: "global" }));

    const duplicate = await fetch(`${app.url}/api/skills/install`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ source, scope: "global" }),
    });
    expect(duplicate.status).toBe(400);

    const invalid = await fetch(`${app.url}/api/skills/install`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ source, scope: "elsewhere" }),
    });
    expect(invalid.status).toBe(400);

    const inventory = await (await fetch(`${app.url}/api/plugins`)).json() as {
      plugins: Array<{ id: string; commands: Array<{ name: string }> }>;
      candidates: Array<{ id: string; trusted: boolean }>;
      errors: unknown[];
    };
    expect(inventory.plugins).toEqual([]);
    expect(inventory.candidates).toContainEqual(expect.objectContaining({ id: "demo", trusted: false }));
    expect(inventory.candidates).toContainEqual(expect.objectContaining({ id: "second", trusted: false }));
    expect(inventory.errors).toEqual([]);

    const firstTrust = await fetch(`${app.url}/api/plugins/trust`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: "demo" }),
    });
    expect(firstTrust.status).toBe(200);
    const firstInventory = await firstTrust.json() as { plugins: Array<{ id: string; commands: Array<{ name: string }> }> };
    expect(firstInventory.plugins[0]?.id).toBe("demo");
    expect(firstInventory.plugins[0]?.commands.map(command => command.name)).toEqual(["demo-command"]);

    const trusted = await fetch(`${app.url}/api/plugins/trust`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: "second" }),
    });
    expect(trusted.status).toBe(200);
    const trustedInventory = await trusted.json() as { plugins: Array<{ id: string }>; candidates: Array<{ id: string; trusted: boolean }> };
    expect(trustedInventory.plugins.map(entry => entry.id)).toEqual(["demo", "second"]);
    expect(trustedInventory.candidates).toContainEqual(expect.objectContaining({ id: "second", trusted: true }));

    const unknown = await fetch(`${app.url}/api/plugins/trust`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: "missing" }),
    });
    expect(unknown.status).toBe(404);

    const untrusted = await fetch(`${app.url}/api/plugins/untrust`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: "demo" }),
    });
    expect(untrusted.status).toBe(200);
    const untrustedInventory = await untrusted.json() as { plugins: Array<{ id: string }>; candidates: Array<{ id: string; trusted: boolean }> };
    expect(untrustedInventory.plugins.map(entry => entry.id)).toEqual(["second"]);
    expect(untrustedInventory.candidates).toContainEqual(expect.objectContaining({ id: "demo", trusted: false }));
  } finally {
    app.stop();
    if (previousHome === undefined) delete process.env.RINGKO_HOME; else process.env.RINGKO_HOME = previousHome;
    if (previousAgents === undefined) delete process.env.AGENTS_HOME; else process.env.AGENTS_HOME = previousAgents;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
