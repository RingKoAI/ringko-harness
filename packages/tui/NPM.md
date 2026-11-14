<p align="center">
  <img src="icon/ringko.svg" alt="RingKo Harness" width="96" height="96">
</p>

# RingKo Harness

RingKo Harness is a provider-neutral Agent Harness for coding agents, not a single
chat front end. The packages provide the tool registry and approval gate,
event-sourced sessions, context compaction, delegated tasks, MCP, skills, and a
host-facing SDK.

`@ringko-ai/rkh` installs the built-in `ringko` command over those facilities: an
interactive terminal UI (plain `ringko`, the default) and a browser UI
(`ringko web`, which prints the URL to open). Both run the same tool registry,
the same approval gate and the same event-sourced session log. Node.js 24+ is
required for the launcher; **Bun does not need to be installed**. The executable
includes its own runtime. This packaging applies to the next release; older npm
versions may still use a Bun script launcher.

```sh
npm install -g @ringko-ai/rkh
ringko          # terminal interface (default)
ringko web      # local backend + browser interface, prints its URL
```

`ringko help` lists every command. Without a global install, `npx @ringko-ai/rkh tui`
and `bunx @ringko-ai/rkh tui` run the same CLI.

Prerelease versions publish under the `next` dist-tag: `npm install -g @ringko-ai/rkh@next`.

This package bundles the CLI, built-in model providers and the WebUI assets.
Its exact-version optional dependency provides the native executable for Linux
x64/arm64, macOS x64/arm64, or Windows x64. Keep optional dependencies enabled;
if the executable is missing, reinstall with `npm install -g @ringko-ai/rkh --include=optional`.
An unsupported platform or mixed package version reports an actionable error;
there is no runtime download script or fallback to an externally installed Bun.
The browser's interactive terminal uses Node.js and the `node-pty` dependency.
Custom provider modules configured by the host are loaded separately at runtime.
The package installs the `ringko` command; the standalone platform binaries
use the same name. For source development and standalone binaries, see the
[repository](https://github.com/RingKoAI/ringko-harness); the Chinese README is
[README.zh-CN.md](https://github.com/RingKoAI/ringko-harness/blob/main/README.zh-CN.md).

## Documentation

- [Configuration](https://github.com/RingKoAI/ringko-harness/blob/main/docs/configuration.md)
- [MCP servers](https://github.com/RingKoAI/ringko-harness/blob/main/docs/mcp.md)
- [Providers](https://github.com/RingKoAI/ringko-harness/blob/main/docs/providers.md)
- [Sandbox](https://github.com/RingKoAI/ringko-harness/blob/main/SANDBOX.md)

## Automatic npm releases

The `release.yml` workflow publishes this package after all platform binaries,
tests, type checks and npm package smoke checks succeed. Push a version tag that
exactly matches `packages/tui/package.json`, such as `v0.1.0`. Stable versions use
the `latest` npm dist-tag; prerelease versions use `next`. Manual workflow runs
on branches build binaries only. npm does not allow replacing a published version;
use a new version and tag for each release.

The five `@ringko-ai/rkh-{linux,darwin,win32}-{x64,arm64}` platform packages
(Windows x64 only) are published first at the exact same version, followed by
`@ringko-ai/rkh`. Each platform package needs scope permission and its own npm
Trusted Publisher configuration. Publish/bootstrap those package names from an
authorized account before relying on OIDC; the main package must not be released
until all platform publications succeed.

Publishing uses npm Trusted Publishing (OIDC), not `GITHUB_TOKEN` or an npm token.
Configure the npm package's Trusted Publisher as:

- Organization or user: `RingKoAI`
- Repository: `ringko-harness`
- Workflow filename: `release.yml`
- Environment: leave empty
- Allowed actions: allow direct `npm publish`

If the package does not exist yet, first publish the initial version from an
authorized npm account, then configure its Trusted Publisher. The npm scope
`@ringko-ai` must grant that account publishing access. Complete the first OIDC
publish within two days of creating the trusted publisher configuration.

To prepare and check the package locally:

```sh
pnpm build:npm:local # current host only; requires Bun and a C11 build toolchain
pnpm test:npm
pnpm test:npm:install # installs actual local npm tarballs; child PATH excludes Bun
cd dist/npm-tui
npm pack --dry-run
```

Complete release packaging consumes all five verified standalone artifacts with
`bun packages/tui/scripts/pack-npm.mjs --artifacts <downloaded-release-artifacts>`.
Outputs are `dist/npm-tui/` and `dist/npm-platforms/<platform>-<arch>/`.
The local-only main package is marked private and cannot be published accidentally.
