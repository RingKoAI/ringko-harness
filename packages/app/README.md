# @ringko-ai/app

Desktop application surface for RingKo. It hosts the SDK and embeds the Web UI
bundle.

The desktop runtime is not chosen yet. `src/index.ts` currently exposes a
runtime-neutral `createApp` factory so the Web UI and a future Tauri or Electron
shell can share the same entry point.
