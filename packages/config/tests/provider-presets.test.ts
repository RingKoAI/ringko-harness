import { expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PROVIDER_PRESETS, type ProviderPreset } from "../src/presets.ts";

it("registers each independent provider module once without omitting definitions", async () => {
  const directory = join(import.meta.dir, "../src/providers");
  const files = readdirSync(directory).filter(name => name.endsWith(".ts") && name !== "types.ts");
  const modules = await Promise.all(files.map(async file => {
    const entry = await import(pathToFileURL(join(directory, file)).href) as { default: ProviderPreset };
    expect(entry.default.id).toBe(file.slice(0, -3)); return entry.default;
  }));
  expect(modules.map(entry => entry.id).sort()).toEqual(PROVIDER_PRESETS.map(entry => entry.id).sort());
  expect(new Set(PROVIDER_PRESETS.map(entry => entry.id)).size).toBe(PROVIDER_PRESETS.length);
  for (const preset of PROVIDER_PRESETS) {
    expect(preset.label.length).toBeGreaterThan(0); expect(["apikey", "oauth"]).toContain(preset.auth ?? "missing");
    if (preset.baseURL) expect(["https:", "http:"]).toContain(new URL(preset.baseURL).protocol);
  }
});
