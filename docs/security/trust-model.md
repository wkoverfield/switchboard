# Trust Model

The full, adversarial security analysis lives in
[threat-model.md](threat-model.md). That document is the diligence artifact:
components, trust boundaries, STRIDE analysis, and the accepted-risks list.
This page is the short posture summary.

- **Local-first.** No server, no account, no telemetry. State lives on the
  user's machine under XDG paths with restrictive file modes.
- **Binding on routed paths.** Pass (mandate) policy is enforced on every call
  through Switchboard MCP endpoints and `switchboard run`: deny-wins tool
  policy, branch binding, profile filtering, approval gates, lease expiry, and
  child-pass subset validation.
- **Advisory everywhere else.** Raw shell, provider CLIs, direct MCP routes,
  and browser sessions bypass Switchboard. `switchboard scan` detects and
  reports those routes; Switchboard is not a sandbox and does not claim to be.
- **Secrets stay in the OS keychain.** Config and profiles hold printable
  `secretRef` ids, never values. Weaker backends require an explicit unsafe
  opt-in. Values are injected only into the spawned upstream that declared
  them.
- **Audit is local and tamper-evident.** JSONL entries are hash-chained and
  checkable with `switchboard audit verify`. Logs are metadata-only, redacted,
  and never uploaded. See [audit-logs.md](audit-logs.md).
- **The accepted trust boundary is the OS user.** A malicious same-uid process
  can defeat local controls; defending against that is explicitly out of
  scope, and the threat model says exactly what that implies.

If behavior and these statements ever disagree, report it via
[SECURITY.md](../../SECURITY.md).
