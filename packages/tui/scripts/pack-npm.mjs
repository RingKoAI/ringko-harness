import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { NPM_PACKAGE_NAME, NPM_CLI_COMMAND } from "../src/cli-identity.ts";
import "./check-version.mjs";
import { buildNative, nativeTarget, nativeManifest, NATIVE_TARGETS } from "../../tools/scripts/build-native.mjs";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const output = resolve(repositoryRoot, "dist/npm-tui");
const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
const appManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "packages/app/package.json"), "utf8"));
const webui = resolve(repositoryRoot, "packages/webui/dist");
const npmName = NPM_PACKAGE_NAME;
const command = NPM_CLI_COMMAND;
const entry = `${command}.mjs`;
const localOnly = process.argv.includes("--local-native");
buildNative(nativeTarget());
const natives = (localOnly ? [nativeTarget()] : NATIVE_TARGETS).map(target => {
  const artifact = nativeManifest(target);
  if (!artifact) throw new Error(`Missing matching ${target} native artifact. Use the release CI matrix, or --local-native for a local-only smoke package.`);
  return artifact;
});

if (!existsSync(resolve(webui, "index.html"))) {
  throw new Error("Build @ringko-ai/webui before preparing the npm package.");
}

rmSync(output, { recursive: true, force: true });
mkdirSync(resolve(output, "bin"), { recursive: true });
for (const native of natives) {
  const directory = resolve(output, "bin/native", native.target); mkdirSync(directory, { recursive: true });
  copyFileSync(native.path, resolve(directory, native.file));
  copyFileSync(resolve(native.directory, "binding.json"), resolve(directory, "binding.json"));
}
const result = await Bun.build({
  entrypoints: [resolve(packageRoot, "src/cli.ts")],
  target: "bun",
  outdir: resolve(output, "bin"),
  naming: entry,
  banner: "#!/usr/bin/env bun",
});
if (!result.success || result.outputs.length !== 1) {
  for (const log of result.logs) console.error(log);
  throw new Error("Failed to build the npm CLI bundle.");
}

writeFileSync(resolve(output, "package.json"), `${JSON.stringify({
  name: npmName,
  version: manifest.version,
  description: "Provider-neutral Agent Harness infrastructure: tool registry, approval gate, sessions, terminal and web interfaces.",
  type: "module",
  ...(localOnly ? { private: true, os: [process.platform], cpu: [process.arch] } : {}),
  license: manifest.license,
  bin: { [command]: `bin/${entry}` },
  engines: { node: ">=24", bun: ">=1.2.0" },
  files: ["bin/", "webui/", "icon/", "README.md", "LICENSE", "NOTICE"],
  dependencies: { "node-pty": appManifest.dependencies["node-pty"] },
  repository: { type: "git", url: "git+https://github.com/RingKoAI/ringko-harness.git" },
  publishConfig: { access: "public" },
}, null, 2)}\n`);
copyFileSync(resolve(repositoryRoot, "LICENSE"), resolve(output, "LICENSE"));
copyFileSync(resolve(repositoryRoot, "NOTICE"), resolve(output, "NOTICE"));
copyFileSync(resolve(repositoryRoot, "packages/app/src/terminal-bridge.mjs"), resolve(output, "bin/terminal-bridge.mjs"));
cpSync(webui, resolve(output, "webui"), { recursive: true });
cpSync(resolve(repositoryRoot, "icon"), resolve(output, "icon"), { recursive: true });
copyFileSync(resolve(packageRoot, "NPM.md"), resolve(output, "README.md"));
console.log(`Prepared ${npmName}@${manifest.version} in ${output}`);
