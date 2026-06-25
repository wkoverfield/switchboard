# Alpha Distribution

This page is for pre-public alpha packaging checks. It does not publish
Switchboard. It verifies that a fresh developer can build, pack, and run the
local CLI before a non-Wilson user test.

## Source Install

```bash
pnpm install
pnpm build
pnpm switchboard --help
```

From a source checkout, run CLI commands as `pnpm switchboard ...`. A packaged
install exposes the shorter `switchboard ...` binary.

Then follow the canonical GitHub CI path in `docs/install/quickstart.md`.

## Package Pack Check

```bash
pnpm build
pnpm smoke:package-pack
```

The smoke packs:

- `@switchboard-mcp/core`
- `@switchboard-mcp/mcp-runtime`
- `@switchboard-mcp/cli`

It verifies package metadata, README inclusion, built `dist/index.js`, the
`switchboard` binary entrypoint, publishable internal dependency versions, and
that compiled test files are not included in tarballs.

## Client Install Checks

```bash
pnpm smoke:install-codex
pnpm smoke:install-claude
pnpm smoke:install-write-codex
pnpm smoke:install-write-claude
```

These prove generated Codex and Claude Code config points at
`switchboard --cwd <repo> mcp`, and write-mode installers create backups before
mutating project config.

## Known Alpha Limitations

- Packages are marked `UNLICENSED` until a release license decision is made.
- Provider safety templates do not install provider MCP servers or create
  provider tokens.
- GitHub CI is the primary alpha path; Vercel Preview is the secondary proof.
- Cursor and VS Code docs are placeholders until their install surfaces are
  implemented.
- Live least-privilege provider dogfood still needs tester-supplied tokens.
- Switchboard is not an orchestrator; harnesses launch agents and use
  Switchboard for scoped authority.
