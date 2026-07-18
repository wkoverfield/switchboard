# The Seatbelt

The seatbelt is a small catastrophe denylist that is on by default on every
machine after `switchboard setup`. With zero grants and zero configuration,
routed MCP calls that match a catastrophe pattern are denied, and the same
patterns guard agent shell commands through a harness hook. Everything else
behaves exactly as before: the seatbelt only speaks up on catastrophe-class
calls.

Curation rule: a pattern ships in the default list only if the action it
matches is IRREVERSIBLE and EXTERNALLY VISIBLE. Everyday flows must never
trip it: Vercel preview deploys, Convex dev deploys, Stripe test-mode calls,
dev-database teardown, and force-pushes to feature branches all pass
untouched. False positives are treated as release blockers, not tuning
items.

## Where it applies

- **Routed MCP calls.** Every call through `switchboard mcp` or
  `switchboard serve` is checked against the denylist, whether or not a pass
  is bound. Under an active pass the seatbelt is a floor beneath the pass
  policy: a pass can narrow further, but cannot allow its way past the
  seatbelt.
- **Agent shell commands (Claude Code).** `switchboard hooks install claude`
  adds a PreToolUse hook on the Bash tool to `~/.claude/settings.json`. The
  hook runs `switchboard hooks check`, which reads the same denylist from
  the global config, so there is one source of truth for both surfaces.
  `switchboard setup` installs the hook by default; `--no-hooks` records an
  opt-out.

Honesty note: the hook is harness-level, not OS enforcement. It guards
commands issued through Claude Code's Bash tool. It does not sandbox the
machine, and a process outside the harness is not covered. If the
`switchboard` binary is missing at hook time, the hook fails open.

## The v1 list

Matching is a case-insensitive regular expression over the call text: the
namespaced tool name plus JSON arguments for MCP calls, the raw command
string for shell hooks. Patterns never match across `&&`, `||`, `;`, or `|`
boundaries.

| Pattern | Matches | Reason |
| --- | --- | --- |
| `prod-deploy-flag` | `deploy ... --prod` / `--production` | deploy command explicitly targeting production |
| `vercel-prod` | `vercel ... --prod` | Vercel production deploy; previews deploy without `--prod` |
| `convex-prod-deploy` | `convex deploy` | pushes to the production deployment; `npx convex dev` pushes to dev |
| `prod-deploy-tool` | `deploy-prod` / `deploy_prod` tool names | production deploy tool call |
| `stripe-live-secret-key` | `sk_live_...` / `rk_live_...` | live-mode secret keys move real money; `sk_test_` keys pass |
| `stripe-live-mode-flag` | `stripe ... --live` | Stripe CLI live mode operates on real payments |
| `vercel-dns-mutation` | `vercel dns add/rm/import` | DNS record mutation; `vercel dns ls` passes |
| `vercel-domain-mutation` | `vercel domains add/rm/buy/move/transfer-in` | domain registration or transfer; `ls` and `inspect` pass |
| `route53-record-change` | `change-resource-record-sets` | Route 53 DNS record mutation |
| `force-push-default-branch` | `git push` with a force flag AND ref `main`/`master` | rewrites the default branch history; force-pushes to feature branches pass |
| `force-push-refspec-default-branch` | `git push ... +main` / `+...:main` | a `+` refspec is a force push to the default branch |

Destructive SQL is deliberately NOT in v1: QA teardown legitimately drops
dev tables, and SQL patterns without target awareness cannot tell dev from
prod.

## What a trip looks like

A tripped call is denied immediately with the pattern name, the reason, and
the exact recovery commands, and an approval request is queued:

```
switchboard seatbelt: vercel-prod; Vercel production deploy (previews deploy
without --prod); approval request approval-3 is pending; approve with:
switchboard approve approval-3 --reason "<why this is safe>"; then retry the
same call; or disable the seatbelt with "seatbelt: off" in
~/.config/switchboard/config.yaml
```

Agent loops never hang: the denial returns instantly, and a human can
approve from another terminal. After approval, retrying the same call
succeeds. The approval covers that pattern and tool: under an active pass it
lasts until the pass expires; with no pass bound it lasts 15 minutes. Trips,
approvals, and the successful retry all land in the local audit log
(`switchboard logs`, `switchboard audit verify`). Hook-layer denials land in
the same log via `switchboard audit append`.

## Opting out and tuning

The seatbelt reads only the machine-level global config
(`~/.config/switchboard/config.yaml`, respecting `XDG_CONFIG_HOME`). A
repo's `.switchboard.yaml` cannot turn it off or trim it, so a writable repo
file is not a bypass.

Turn it off entirely:

```yaml
seatbelt: off
```

Or for one session: `switchboard mcp --no-seatbelt` /
`switchboard serve --no-seatbelt`.

Extend or trim the list under the machine policy stanza:

```yaml
policies:
  default:
    seatbelt:
      add:
        - name: my-launcher
          pattern: "\\bmy-cli\\s+launch-prod\\b"
          reason: "launches production"
      remove:
        - route53-record-change
```

Remove the Claude Code hook with `switchboard hooks uninstall claude`; it
restores the settings file to its pre-install content.
