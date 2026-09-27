// Compile the ringko CLI into a standalone binary.
//
//   bun packages/tui/scripts/compile.mjs <outfile> [target]
//
// Bun does not create the output directory (notably on Windows), so this
// wrapper creates it first and then shells out to `bun build --compile`.
import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const [outfileArg, target] = process.argv.slice(2);

if (!outfileArg) {
  console.error("usage: compile.mjs <outfile> [target]");
  process.exit(2);
}

const outfile = resolve(process.cwd(), outfileArg);
mkdirSync(dirname(outfile), { recursive: true });

const args = [
  "build",
  resolve(packageRoot, "src/cli.ts"),
  "--compile",
  `--outfile=${outfile}`,
  // Providers are introduced at run time (see src/provider.ts); keep them out of
  // the binary so the core stays provider-neutral and lean.
  "--external",
  "@ringko-ai/providers",
];
if (target) {
  args.push(`--target=${target}`);
}

const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: packageRoot });
process.exit(result.status ?? 1);
