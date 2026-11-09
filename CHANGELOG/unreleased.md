# Unreleased

- Use worker-isolated Node-API file transactions for write/edit and upload commits,
  with pinned directory ancestry, no-follow checks and atomic replacement.
  Source development needs `pnpm build:native`; official npm/standalone packages
  carry matching prebuilt modules. Add native architecture and packaging checks.
- Bound edit input/output and replacement counts. Preserve literal replacement
  syntax, reject creation races and keep failed file operations from leaking locks.
- Run grep regexes in a terminable worker and enforce per-file/cumulative read,
  result and deadline budgets. Keep glob patterns/results within their approved root.
- Allowlist external CLI/ACP ambient environment; add explicit `inheritEnv` and
  command-provider deadlines. Bound stdout, stderr, frames and line sizes; safely
  launch Windows shims and reject unsupported shell interpolation.
- Stream multipart uploads with request/file/count limits, serialize workspace
  quotas, use unique names and identity-checked rollback, and drain active uploads
  on shutdown. Existing attachments are not automatically deleted.
- Bound model-rendered text separately from raw SDK results. Preserve the current
  HTTPS/SHA-256 update trust policy; no signature/attestation requirement is added.
- Restore the advertised explicit `tui` command alongside the default terminal UI.
