import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import embedded from "#ringko-file-binding";

let selected: string | undefined;
export function nativeFileBinding(): string {
  if (selected) return selected;
  if (embedded) return selected = embedded;
  const target = `${process.platform}-${process.arch}`;
  const directories = [resolve(import.meta.dir, "../native/bin", target), join(import.meta.dir, "native", target)];
  for (const directory of directories) {
    try {
      const metadata = JSON.parse(readFileSync(join(directory, "binding.json"), "utf8"));
      if (metadata.protocol !== 3 || metadata.target !== target || !/^ringko-secure-files-[a-f0-9]{16}\.node$/.test(metadata.file) || !/^[a-f0-9]{64}$/.test(metadata.sha256)) continue;
      const path = join(directory, metadata.file);
      if (createHash("sha256").update(readFileSync(path)).digest("hex") !== metadata.sha256) throw new Error("Native file module integrity mismatch.");
      return selected = path;
    } catch (error) { if (error instanceof Error && error.message.includes("integrity mismatch")) throw error; }
  }
  throw new Error(`Missing secure file module for ${target}. Run pnpm build:native in a source checkout, or reinstall an official package containing the prebuilt native modules.`);
}
