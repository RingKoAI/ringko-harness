import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const output = resolve(repositoryRoot, "dist/npm-tui");
const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
const appManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "packages/app/package.json"), "utf8"));
const webui = resolve(repositoryRoot, "packages/webui/dist");

if (!existsSync(resolve(webui, "index.html"))) {
  throw new Error("Build @ringko-ai/webui before preparing the npm package.");
}

rmSync(output, { recursive: true, force: true });
mkdirSync(resolve(output, "bin"), { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(packageRoot, "src/cli.ts")],
  target: "bun",
  outdir: resolve(output, "bin"),
  naming: "ringko.mjs",
  banner: "#!/usr/bin/env bun",
});
if (!result.success || result.outputs.length !== 1) {
  for (const log of result.logs) console.error(log);
  throw new Error("Failed to build the npm CLI bundle.");
}

writeFileSync(resolve(output, "package.json"), `${JSON.stringify({
  name: manifest.name,
  version: manifest.version,
  description: "RingKo interactive agent CLI",
  type: "module",
  license: manifest.license,
  bin: { ringko: "bin/ringko.mjs" },
  engines: { node: ">=24", bun: ">=1.2.0" },
  files: ["bin/", "webui/", "README.md", "LICENSE", "NOTICE"],
  dependencies: { "node-pty": appManifest.dependencies["node-pty"] },
  repository: { type: "git", url: "git+https://github.com/RingKoAI/ringko-harness.git" },
  publishConfig: { access: "public" },
}, null, 2)}\n`);
copyFileSync(resolve(repositoryRoot, "LICENSE"), resolve(output, "LICENSE"));
copyFileSync(resolve(repositoryRoot, "NOTICE"), resolve(output, "NOTICE"));
copyFileSync(resolve(repositoryRoot, "packages/app/src/terminal-bridge.mjs"), resolve(output, "bin/terminal-bridge.mjs"));
cpSync(webui, resolve(output, "webui"), { recursive: true });
copyFileSync(resolve(packageRoot, "NPM.md"), resolve(output, "README.md"));
console.log(`Prepared ${manifest.name}@${manifest.version} in ${output}`);
