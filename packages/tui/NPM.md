# RingKo Harness

RingKo is a provider-neutral agent harness. The `ringko` command offers two
interface styles: an interactive terminal UI (plain `ringko`, the default) and a
browser UI (`ringko serve`, which prints the URL to open). Both run the same tool
registry, the same approval gate and the same event-sourced session log.

`@ringko-ai/rkh` installs that command globally. The executable is a Bun bundle, so
Node.js 24+ **and** [Bun](https://bun.sh/) 1.2+ must be on `PATH` — Bun is not
optional.

```sh
npm install -g @ringko-ai/rkh
ringko          # terminal interface (default)
ringko serve    # local backend + browser interface, prints its URL
```

`ringko help` lists every command. Without a global install, `npx @ringko-ai/rkh tui`
and `bunx @ringko-ai/rkh tui` run the same CLI.

Prerelease versions publish under the `next` dist-tag: `npm install -g @ringko-ai/rkh@next`.

This package bundles the CLI, built-in model providers and the WebUI assets.
The browser's interactive terminal uses Node.js and the `node-pty` dependency.
Custom provider modules configured by the host are loaded separately at runtime.
The package installs the `ringko` command; the standalone platform binaries
use the same name. For source development and standalone binaries, see the
[repository](https://github.com/RingKoAI/ringko-harness); the Chinese README is
[README.zh-CN.md](https://github.com/RingKoAI/ringko-harness/blob/main/README.zh-CN.md).

## Automatic npm releases

The `release.yml` workflow publishes this package after all platform binaries,
tests, type checks and npm package smoke checks succeed. Push a version tag that
exactly matches `packages/tui/package.json`, such as `v0.1.0`. Stable versions use
the `latest` npm dist-tag; prerelease versions use `next`. Manual workflow runs
on branches build binaries only. npm does not allow replacing a published version;
use a new version and tag for each release.

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
pnpm build:npm
pnpm test:npm
cd dist/npm-tui
npm pack --dry-run
```
