# RingKo Desktop

Reserved workspace for the Electron + TypeScript desktop host.

- Package: `@ringko-ai/rkh-desktop` (`private: true`).
- Reuse the shared backend and WebUI; own desktop windows, native integration,
  updates, and backend process lifecycle.
- Desktop runtime and packaging dependencies belong to this workspace when
  desktop implementation begins.

## CLI distribution boundary

The published `@ringko-ai/rkh` CLI is built independently by
`packages/tui/scripts/pack-npm.mjs`. It publishes an explicit file allowlist and
does not depend on this workspace or Electron. Global CLI installation therefore
does not install the desktop host. Keep dependencies directed from the desktop
host toward shared packages, without importing desktop code into CLI packages.

The private flag prevents publishing this workspace itself; the CLI dependency
and artifact boundaries keep desktop dependencies out of the CLI distribution.
