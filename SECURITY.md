# Security Policy

Switchboard handles credentials and controls what AI coding agents can reach,
so security reports get priority over everything else.

## Reporting a vulnerability

Please do not open a public issue for anything security-sensitive.

Use GitHub's private vulnerability reporting:
[Report a vulnerability](https://github.com/wkoverfield/switchboard/security/advisories/new).

You can expect an acknowledgment within a few days. Switchboard is a solo-run
alpha project, so there is no security team or bounty program, but real
reports get fixed fast and credited if you want credit.

## Scope

The full security analysis, including trust boundaries and the accepted-risks
list, is in the [threat model](docs/security/threat-model.md). If shipped
behavior contradicts that document, the contradiction itself is in scope.

Reports that matter most:

- Secret values surfacing anywhere: output, logs, JSON, audit entries, MCP
  responses, backups Switchboard itself creates.
- A pass failing to enforce its policy on a routed path: denied tools
  reachable, expired passes still working, approval gates bypassed through
  Switchboard.
- Keychain handling flaws, including unsafe fallback activation without the
  explicit opt-in.

Known and documented limits, not vulnerabilities:

- Switchboard only governs paths routed through it. Raw shell access, direct
  MCP routes, provider CLIs, and browser sessions can bypass it. `switchboard
  scan` exists to surface those routes; the README says this plainly.
- Rollback backups are exact copies of prior config and may contain tokens
  that were already in plaintext before import.

## Supported versions

Alpha: only the latest published version of `@switchboard-mcp/cli` is
supported. There are no backports.
