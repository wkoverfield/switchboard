# Trust Model

Switchboard is local-first. Remote telemetry is planned to be opt-in only.
Provider secrets should not be stored in repo config, agent MCP config, mandate
records, harness JSON payloads, or audit logs.

Switchboard now writes local JSONL audit logs for profile tests, routed tool
calls, mandate policy denials, and approval-gated blocks. Logs are stored under
XDG state paths and are never uploaded automatically.

Switchboard has local mandate enforcement for allow/deny/approval-required tool
patterns and local approval request decisions. Full approval brokering,
provider-specific enforcement, secrets implementation, and stronger daemon
socket security are later milestones.

The accepted secrets direction is local OS-backed secret storage referenced by
printable `secretRef` ids from config/profiles. `switchboard secrets` stores
values through the local keychain adapter and maintains a value-free ref index
for listing. Native OS-protected backends are allowed by default; file/null/CLI
fallback storage, including Linux `secret-tool`, requires an explicit unsafe
dev/demo opt-in. Active mandates
should grant temporary access to profiles and
tools, not raw secret values. Mandate reports and escalations may identify
missing `secretRef` ids for scoped profiles as local readiness blockers, but
they must not include secret values. Provider presets are blocked until the secret
foundation has held up through local dogfood with doctor checks, runtime
injection, generated-config safety, and audit redaction. See
`secrets-keychain-architecture.md`.
