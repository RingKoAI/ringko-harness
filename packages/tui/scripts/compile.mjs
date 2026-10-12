// Compile the ringko CLI into a standalone binary.
//
//   bun packages/tui/scripts/compile.mjs <outfile> [target]
//
// Bun does not create the output directory (notably on Windows), so this
// wrapper creates it first and then shells out to `bun build --compile`.
import { cpSync, existsSync, mkdirSync } from "node:fs";
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
const webui = resolve(packageRoot, "../webui/dist");
if (!existsSync(resolve(webui, "index.html"))) {
  console.error("Build @ringko-ai/webui before compiling the shared backend/TUI.");
  process.exit(2);
}
// A relocatable sidecar keeps standalone TUI and browser clients on the same service.
cpSync(webui, resolve(dirname(outfile), "webui"), { recursive: true });

const args = [
  "build",
  resolve(packageRoot, "src/cli.ts"),
  "--compile",
  `--outfile=${outfile}`,
];
if (target) {
  args.push(`--target=${target}`);
}

const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: packageRoot });
process.exit(result.status ?? 1);
