import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const output = resolve(repositoryRoot, "dist/npm-tui");
const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));

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
  engines: { bun: ">=1.2.0" },
  files: ["bin/ringko.mjs", "README.md", "LICENSE"],
  publishConfig: { access: "public" },
}, null, 2)}\n`);
copyFileSync(resolve(repositoryRoot, "LICENSE"), resolve(output, "LICENSE"));
copyFileSync(resolve(packageRoot, "NPM.md"), resolve(output, "README.md"));
console.log(`Prepared ${manifest.name}@${manifest.version} in ${output}`);
