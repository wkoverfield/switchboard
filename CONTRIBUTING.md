# Contributing to Switchboard

Thanks for your interest. Switchboard is alpha software moving quickly, so the
best first move for anything bigger than a small fix is to open an issue and
talk it through before you build. Small, focused PRs are welcome.

## Getting set up

```bash
git clone https://github.com/wkoverfield/switchboard && cd switchboard
pnpm install
pnpm build
pnpm test
```

Requires Node 22+ and pnpm. Run the CLI from source with `pnpm switchboard ...`.

Smoke tests live in `scripts/smoke/` and `package.json` scripts; CI runs the
full set. `pnpm smoke:grant-badge` is a quick end-to-end sanity check.

## Ground rules for changes

Switchboard is a security tool, so a few properties are load-bearing. Please
keep them intact:

- **Secret values never surface.** Not in CLI output, JSON, logs, audit
  entries, error messages, or test fixtures. Everything references secrets by
  ref name. A change that prints a value, even in a debug path, is a bug.
- **Never claim safety the tool does not enforce.** Copy is part of the
  product. If a feature only covers routed paths, the words must say so. When
  detection fails, output says "unknown", never a guessed "safe" or "none".
- **Machine contracts stay stable.** JSON keys, `schemaVersion` strings, error
  `code` values, flag names, and store paths are versioned interfaces.
  Additive changes are fine; renames and removals are not, without a version
  bump and a discussion first.
- **Human words are "pass", machine tokens keep "mandate".** The CLI's human
  surface speaks pass vocabulary. Schema names, error codes, and flags keep
  their existing mandate spellings for compatibility.
- **Local-first, no phoning home.** No telemetry, no network calls the user
  did not ask for, OS keychain by default. Plaintext fallbacks stay behind the
  explicit `SWITCHBOARD_ALLOW_UNSAFE_SECRET_BACKENDS=1` opt-in.

## Sending a pull request

1. Fork and branch (`fix/...`, `feat/...`, `docs/...`, `chore/...`).
2. Add or update tests. CLI behavior is tested in
   `apps/cli/src/program.test.ts`; core logic next to its module. Copy changes
   need their assertions updated, not weakened.
3. `pnpm build`, `pnpm test`, and `pnpm lint` should all pass.
4. Keep the change focused, and say what it does and why in the PR.

For anything touching secrets handling, pass policy enforcement, or the
approval flow, include a short note on the failure mode you are guarding
against. Those reviews get extra scrutiny by design.

## Reporting bugs

Open an issue with the smallest repro you can. `switchboard doctor` output and
redacted `--json` output are the most useful things to include. Never paste
real tokens, even expired ones.

For security vulnerabilities, do not open a public issue. See
[SECURITY.md](SECURITY.md).
