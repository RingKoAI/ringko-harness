// Compile the ringko CLI into a standalone binary.
//
//   bun packages/tui/scripts/compile.mjs <outfile> [target]
//
// Bun does not create the output directory (notably on Windows), so this
// wrapper also embeds the matching prebuilt Node-API file module.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildNative, nativeTarget } from "../../tools/scripts/build-native.mjs";

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

const native = buildNative(nativeTarget(target));
cpSync(native.directory, resolve(dirname(outfile), "native", native.target), { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(packageRoot, "src/main.ts")], target: "bun",
  compile: { outfile, ...(target ? { target } : {}) },
  loader: { ".node": "file" },
  plugins: [{ name: "secure-file-binding", setup(build) {
    build.onResolve({ filter: /^#ringko-file-binding$/ }, () => ({ path: native.path }));
  } }],
});
if (!result.success) { for (const log of result.logs) console.error(log); process.exit(1); }
console.log(`Compiled ${outfile} with embedded ${native.target} secure file module.`);
