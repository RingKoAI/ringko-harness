import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const source = resolve(import.meta.dir, "../native/files");
const headers = require("node-api-headers");
export const NATIVE_TARGETS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];
export function nativeTarget(value = `${process.platform}-${process.arch}`) {
  const normalized = value.replace(/^bun-/, "").replace(/^windows-/, "win32-");
  if (!NATIVE_TARGETS.includes(normalized)) throw new Error(`Unsupported native file target: ${value}`);
  return normalized;
}
export function fingerprint(target) {
  const hash = createHash("sha256").update(target).update("node-api-v8-files-v3");
  for (const name of ["binding.cc", "platform.h", target.startsWith("win32-") ? "windows.cc" : "posix.cc"]) hash.update(name + "\0").update(readFileSync(join(source, name))).update("\0");
  for (const name of ["node_api.h", "node_api_types.h", "js_native_api.h", "js_native_api_types.h"]) hash.update(name + "\0").update(readFileSync(join(headers.include_dir, name))).update("\0");
  hash.update(readFileSync(import.meta.path));
  return hash.digest("hex");
}
export function nativeDirectory(target) { return resolve(source, "../bin", target); }
export function validateNativeBinary(data, target) {
  let machine;
  if (target.startsWith("win32-")) {
    const offset = data.length >= 64 ? data.readUInt32LE(60) : data.length;
    if (data.length >= 64 && data.readUInt16LE(0) === 0x5a4d && offset <= data.length - 24 && data.readUInt32LE(offset) === 0x4550) machine = data.readUInt16LE(offset + 4);
    if (machine === 0x8664) return;
  } else if (target.startsWith("linux-")) {
    if (data.length >= 64 && data.readUInt32BE(0) === 0x7f454c46 && data[4] === 2 && data[5] === 1) machine = data.readUInt16LE(18);
    if (machine === (target.endsWith("arm64") ? 183 : 62)) return;
  } else if (target.startsWith("darwin-")) {
    if (data.length >= 32 && data.readUInt32LE(0) === 0xfeedfacf) machine = data.readUInt32LE(4);
    if (machine === (target.endsWith("arm64") ? 0x0100000c : 0x01000007)) return;
  }
  throw new Error(`Native module architecture does not match ${target}; check the selected compiler and target toolchain.`);
}
export function nativeManifest(target) {
  const directory = nativeDirectory(target), expected = fingerprint(target);
  try {
    const data = JSON.parse(readFileSync(join(directory, "binding.json"), "utf8"));
    if (data.fingerprint === expected && data.target === target && data.protocol === 3 && /^ringko-secure-files-[a-f0-9]{16}\.node$/.test(data.file)) {
      const file = join(directory, data.file);
      const binary = readFileSync(file); validateNativeBinary(binary, target);
      if (createHash("sha256").update(binary).digest("hex") === data.sha256) return { ...data, directory, path: file };
    }
  } catch { /* A missing/stale build is rebuilt locally or reported for cross targets. */ }
  return undefined;
}
export function buildNative(target = nativeTarget()) {
  target = nativeTarget(target);
  const cached = nativeManifest(target);
  if (cached) return cached;
  const [platform, arch] = target.split("-");
  if (platform !== process.platform) throw new Error(`Missing ${target} native build. Build it on ${platform} or provide matching CI native artifacts before cross-compiling.`);
  const crossLinux = platform === "linux" && arch !== process.arch;
  const candidates = crossLinux ? [`${arch === "arm64" ? "aarch64" : "x86_64"}-linux-gnu-g++`] : ["clang++", "g++", "clang", "c++"];
  const compiler = process.env.CXX || candidates.map(name => Bun.which(name)).find(Boolean);
  if (!compiler) throw new Error(`A C/C++ compiler is required for ${target}. Install the build toolchain or set CXX to its executable.`);
  const directory = nativeDirectory(target), digest = fingerprint(target), name = `ringko-secure-files-${digest.slice(0, 16)}.node`;
  mkdirSync(directory, { recursive: true });
  const staging = mkdtempSync(join(directory, ".build-")), temporary = join(staging, "binding.node");
  const msvc = /(?:^|[\\/])cl(?:\.exe)?$/i.test(compiler);
  const args = msvc
    ? ["/nologo", "/std:c++17", "/O2", "/W4", "/EHs-c-", "/GR-", "/MT", "/DNAPI_VERSION=8", "/I", headers.include_dir, `/Fo${staging}\\`]
    : ["-std=c++17", "-O2", "-Wall", "-Wextra", "-Wpedantic", "-fno-exceptions", "-fno-rtti", "-DNAPI_VERSION=8", "-I", headers.include_dir];
  if (!msvc) {
    if (platform === "darwin") args.push("-dynamiclib", "-undefined", "dynamic_lookup", "-mmacosx-version-min=13.0", "-arch", arch === "x64" ? "x86_64" : "arm64");
    else args.push("-shared", ...(platform === "linux" ? ["-fPIC"] : []), "-static-libgcc", "-static-libstdc++");
  }
  args.push(join(source, "binding.cc"), join(source, platform === "win32" ? "windows.cc" : "posix.cc"));
  if (msvc) args.push("/link", "/DLL", `/OUT:${temporary}`, "advapi32.lib");
  else { args.push("-o", temporary); if (platform === "win32") args.push("-ladvapi32"); }
  try {
    const result = spawnSync(compiler, args, { cwd: source, stdio: "inherit", windowsHide: true, timeout: 120_000 });
    if (result.error) throw result.error;
    if (result.status !== 0 || !existsSync(temporary)) throw new Error(`Native file build failed for ${target}.`);
    validateNativeBinary(readFileSync(temporary), target);
    const path = join(directory, name);
    renameSync(temporary, path);
    const data = { protocol: 3, target, fingerprint: digest, file: name, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
    const metadata = join(directory, `.manifest-${randomUUID()}.json`);
    writeFileSync(metadata, JSON.stringify(data, null, 2) + "\n", { flag: "wx" }); renameSync(metadata, join(directory, "binding.json"));
    return { ...data, directory, path };
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
if (import.meta.main) console.log(`Native file module: ${buildNative(nativeTarget(process.argv[2])).path}`);
