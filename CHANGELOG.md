# Changelog

## Unreleased

- Scaffolded the TypeScript pnpm workspace.
- Added `@switchboard-mcp/cli` with the `switchboard` binary.
- Added config/profile schemas, config precedence, namespace normalization, and collision detection.
- Added `switchboard status` and `switchboard doctor`.
- Started generic stdio MCP upstream mounting with namespaced tool discovery and routed calls.
- Added a stdio MCP front door through `switchboard serve`.
- Added an end-to-end smoke check for a real `switchboard serve` MCP session.
- Added `switchboard test <profile>` for validating one configured stdio upstream.
