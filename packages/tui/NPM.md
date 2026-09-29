# RingKo CLI

Run the RingKo agent from a terminal with [Bun](https://bun.sh/) installed:

```sh
npx @ringko-ai/tui tui
```

The `ringko` executable requires Bun on your PATH. You can also use
`bunx @ringko-ai/tui tui`, or run `npx @ringko-ai/tui help` to list commands.

This package bundles the CLI and its built-in runtime dependencies. Model
providers configured by the host are loaded separately at runtime. For source
development and standalone platform binaries, see the
[repository](https://github.com/RingKoAI/ringko-harness).
