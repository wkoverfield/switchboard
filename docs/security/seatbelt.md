# The Seatbelt

The seatbelt is a small catastrophe denylist that is on by default on every
machine after `switchboard setup`. With zero grants and zero configuration,
routed MCP calls that match a catastrophe pattern are denied, and the same
patterns guard agent shell commands through a harness hook. Everything else
behaves exactly as before: the seatbelt only speaks up on catastrophe-class
calls.

Curation rule: a pattern ships in the default list only if the action it
matches is IRREVERSIBLE and EXTERNALLY VISIBLE. The goal is that everyday
flows pass untouched: Vercel preview deploys, Convex dev and preview deploys,
Stripe test-mode calls, dev-database teardown, and force-pushes to feature
branches. A false positive on a common flow is treated as a release blocker,
not a tuning item.

## Two surfaces, evaluated differently

The seatbelt is enforced on two surfaces, and they do NOT use the same
matching. Conflating them is what makes a naive denylist trip on a commit
message or a `grep`.

- **Routed MCP calls** (`switchboard mcp` / `switchboard serve`). Every call
  is checked whether or not a pass is bound. Matching is by tool NAME plus
  JSON arguments. Under an active pass the seatbelt is a floor beneath the
  pass policy: a pass can narrow further, but cannot allow its way past the
  seatbelt.
- **Agent shell commands (Claude Code)** via `switchboard hooks install
  claude`, which adds a PreToolUse Bash hook to `~/.claude/settings.json`
  running `switchboard hooks check`. The shell surface does NOT substring-
  match the command line. It splits the line into statements (on `&&`, `||`,
  `;`, `|`, `&`, newline), identifies the invoked command of each, and:
  - hard-excludes read-only and metadata commands from ever tripping (`cat`,
    `grep`, `rg`, `sed`, `awk`, `ls`, `echo`, `printf`, `chmod`, `find`,
    editors, and every `git` subcommand except `push`), and
  - evaluates a deploy or push rule only when the invoked command actually is
    that tool. So `git commit -m "fix vercel --prod"`, `grep "convex deploy"`,
    and `cat scripts/deploy-prod.sh` do not trip: the invoked command is
    `git commit`, `grep`, and `cat`, not `vercel`/`convex`/a deploy.

Because the surfaces differ, coverage is not identical. The `prod-deploy-tool`
name match applies ONLY to the MCP surface (on shell it would match filenames
like `deploy-prod.sh`). DNS/domain/route53 and the Stripe live-mode CLI flag
are shell-surface rules; the MCP surface covers deploy tool names and live
secret keys in arguments. Both surfaces share one denylist source of truth
(the global config), but each applies the rules that make sense for it.

Honesty note: the hook is harness-level, not OS enforcement. It guards
commands issued through Claude Code's Bash tool. It does not sandbox the
machine, a process outside the harness is not covered, and a sufficiently
obfuscated shell line (unusual quoting, indirection through a wrapper script)
can evade the parser. It is defense-in-depth, not a boundary. If the
`switchboard` binary is missing at hook time, the hook fails open.

## The v1 list

| Pattern | Surface | Trips on | Passes (examples) |
| --- | --- | --- | --- |
| `prod-deploy-flag` | shell | a deploy command with `--prod`/`--production`/`--target production` | `pnpm build`, `npm install --production` |
| `vercel-prod` | shell + MCP | `vercel --prod`, `vercel deploy --prod`/`--target production`, `vercel promote`, `vercel alias set`; MCP: a vercel deploy tool with a production target | `vercel build --prod`, `vercel deploy` (preview), `vercel` |
| `convex-prod-deploy` | shell + MCP | `convex deploy` with no preview flag; MCP: a convex deploy tool with no preview arg | `convex deploy --preview-create x`, `npx convex dev` |
| `prod-deploy-tool` | MCP only | tool names like `..._deploy_prod` | any shell command (filenames like `deploy-prod.sh`) |
| `stripe-live-secret-key` | shell + MCP | an `sk_live_`/`rk_live_` key in the command or arguments | `sk_test_...`, `pk_test_...`, `pk_live_...` |
| `stripe-live-mode-flag` | shell | `stripe ... --live` | `stripe products list` |
| `vercel-dns-mutation` | shell | `vercel dns add/rm/import` | `vercel dns ls/inspect` |
| `vercel-domain-mutation` | shell | `vercel domains add/rm/buy/move/transfer-in` | `vercel domains ls/inspect` |
| `route53-record-change` | shell | `aws ... change-resource-record-sets` | `aws route53 list-resource-record-sets` |
| `force-push-default-branch` | shell | `git push` with a force flag (`--force`, `-f`, `--force-with-lease`, `--mirror`, or a `+` refspec) targeting `main`/`master` (including `refs/heads/main`, `HEAD:main`, `+refs/heads/main`, and `git -C <path> push`) | force-push to a feature branch; `git push origin main` without force; `main:not-main` |

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
