import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { NPM_PACKAGE_NAME, NPM_CLI_COMMAND } from "../src/cli-identity.ts";
import { NPM_BINARY_TARGETS } from "./npm-platforms.mjs";
import "./check-version.mjs";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const output = resolve(repositoryRoot, "dist/npm-tui");
const platformsRoot = resolve(repositoryRoot, "dist/npm-platforms");
const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
const appManifest = JSON.parse(readFileSync(resolve(repositoryRoot, "packages/app/package.json"), "utf8"));
const webui = resolve(repositoryRoot, "packages/webui/dist");
const localOnly = process.argv.includes("--local-native");
const artifactIndex = process.argv.indexOf("--artifacts");
if (artifactIndex >= 0 && !process.argv[artifactIndex + 1]) throw new Error("--artifacts requires a directory.");
const artifacts = artifactIndex >= 0 ? resolve(process.argv[artifactIndex + 1]) : undefined;
const targets = localOnly ? NPM_BINARY_TARGETS.filter(target => target.platform === process.platform && target.arch === process.arch) : NPM_BINARY_TARGETS;
if (!targets.length) throw new Error(`Unsupported local platform ${process.platform}-${process.arch}.`);
if (!existsSync(resolve(webui, "index.html"))) throw new Error("Build @ringko-ai/webui first.");

// Compile locally from current source; complete release packs consume the exact
// binaries already verified on each target host, never placeholder executables.
if (localOnly && !artifacts) {
  const result = spawnSync(process.execPath, [resolve(import.meta.dir, "compile.mjs"), resolve(repositoryRoot, "dist", targets[0].artifact)], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Local standalone build failed.");
}
const selected = targets.map(target => {
  const binary = artifacts ? resolve(artifacts, target.artifact, target.artifact) : resolve(repositoryRoot, "dist", target.artifact);
  if (!existsSync(binary)) throw new Error(`Missing ${target.artifact}; build on its target host or provide --artifacts <release-artifacts>.`);
  return { ...target, path: binary };
});
rmSync(output, { recursive: true, force: true }); rmSync(platformsRoot, { recursive: true, force: true });
mkdirSync(resolve(output, "bin"), { recursive: true }); mkdirSync(platformsRoot, { recursive: true });
const repository = { type: "git", url: "git+https://github.com/RingKoAI/ringko-harness.git" };
const optionalDependencies = {};
for (const target of selected) {
  const directory = resolve(platformsRoot, `${target.platform}-${target.arch}`);
  mkdirSync(resolve(directory, "bin"), { recursive: true });
  const binary = resolve(directory, "bin", target.binary);
  // Copy bytes into a new inode: preserve release extraction semantics on Windows.
  writeFileSync(binary, readFileSync(target.path), { mode: 0o755, flag: "wx" });
  chmodSync(binary, 0o755);
  writeFileSync(resolve(directory, "package.json"), JSON.stringify({ name: target.name, version: manifest.version,
    description: `RingKo standalone executable for ${target.platform}-${target.arch}.`, license: manifest.license,
    os: [target.platform], cpu: [target.arch], files: ["bin/", "LICENSE", "NOTICE"], repository, publishConfig: { access: "public" },
  }, null, 2) + "\n");
  for (const name of ["LICENSE", "NOTICE"]) copyFileSync(resolve(repositoryRoot, name), resolve(directory, name));
  optionalDependencies[target.name] = manifest.version;
}
copyFileSync(resolve(import.meta.dir, "npm-launcher.mjs"), resolve(output, "bin/ringko.mjs"));
chmodSync(resolve(output, "bin/ringko.mjs"), 0o755);
writeFileSync(resolve(output, "package.json"), JSON.stringify({ name: NPM_PACKAGE_NAME, version: manifest.version,
  description: "Provider-neutral Agent Harness with standalone terminal and web interfaces. No Bun installation required.",
  type: "module", ...(localOnly ? { private: true, os: [process.platform], cpu: [process.arch] } : {}), license: manifest.license,
  bin: { [NPM_CLI_COMMAND]: "bin/ringko.mjs" }, engines: { node: ">=24" },
  files: ["bin/", "webui/", "icon/", "README.md", "LICENSE", "NOTICE"],
  optionalDependencies, dependencies: { "node-pty": appManifest.dependencies["node-pty"] }, repository, publishConfig: { access: "public" },
}, null, 2) + "\n");
for (const name of ["LICENSE", "NOTICE"]) copyFileSync(resolve(repositoryRoot, name), resolve(output, name));
copyFileSync(resolve(repositoryRoot, "packages/app/src/terminal-bridge.mjs"), resolve(output, "bin/terminal-bridge.mjs"));
cpSync(webui, resolve(output, "webui"), { recursive: true });
cpSync(resolve(repositoryRoot, "icon"), resolve(output, "icon"), { recursive: true });
copyFileSync(resolve(packageRoot, "NPM.md"), resolve(output, "README.md"));
console.log(`Prepared ${NPM_PACKAGE_NAME}@${manifest.version} and ${selected.length} native executable package(s).`);
