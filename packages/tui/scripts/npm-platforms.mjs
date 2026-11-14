export const NPM_BINARY_TARGETS = Object.freeze([
  { platform: "linux", arch: "x64", artifact: "ringko-linux-x64" },
  { platform: "linux", arch: "arm64", artifact: "ringko-linux-arm64" },
  { platform: "darwin", arch: "x64", artifact: "ringko-darwin-x64" },
  { platform: "darwin", arch: "arm64", artifact: "ringko-darwin-arm64" },
  { platform: "win32", arch: "x64", artifact: "ringko-windows-x64.exe" },
].map(target => Object.freeze({ ...target, name: `@ringko-ai/rkh-${target.platform}-${target.arch}`, binary: target.platform === "win32" ? "ringko.exe" : "ringko" })));
