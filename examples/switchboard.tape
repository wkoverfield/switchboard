# Switchboard hero demo for VHS (https://github.com/charmbracelet/vhs).
#
#   brew install vhs          # one-time
#   pnpm build                # build the CLI once
#   vhs examples/switchboard.tape   # run from REPO ROOT -> writes examples/switchboard.gif
#
# ~30s "watch it stop something": the agent works inside a scoped pass, then
# gets DENIED the moment it reaches out of scope. The red DENIED badge is the
# hero frame; the closer is the hash-chained audit log verifying clean.
#
# The "agent" here is a real MCP client (demo-agent.mjs) talking to the real
# Switchboard front door; the allow/deny decisions on screen are live.

Output examples/switchboard.gif

Require node

Set Shell bash
Set FontSize 18
Set Width 1100
Set Height 700
Set Padding 26
Set TypingSpeed 45ms

# ---------- hidden setup ----------
Hide
Type 'ROOT="$PWD"; SB="$ROOT/apps/cli/dist/index.js"; test -f "$SB" || pnpm build >/dev/null 2>&1'
Enter
Type 'D=$(mktemp -d); mkdir -p "$D/acme"; cd "$D/acme"'
Enter
Type 'export XDG_CONFIG_HOME="$D/xdg-config" XDG_DATA_HOME="$D/xdg-data" XDG_STATE_HOME="$D/xdg-state"'
Enter
Type 'export SWITCHBOARD_RUNTIME_DIR="$D/runtime" TS_KEYRING_BACKEND=file SWITCHBOARD_ALLOW_UNSAFE_SECRET_BACKENDS=1'
Enter
Type 'switchboard(){ node "$SB" "$@"; }'
Enter
Type 'agent(){ node "$ROOT/packages/mcp-runtime/scripts/demo-agent.mjs" "$@"; }'
Enter
Type 'git init -q -b fix/ci; git config user.email demo@local; git config user.name demo'
Enter
# A github-ci profile backed by the offline fixture upstream, so the demo is
# deterministic and needs no real GitHub token.
Type 'switchboard add github-ci --command node --arg "$ROOT/packages/mcp-runtime/fixtures/echo-server.mjs" --arg github_acme_ci --arg GITHUB_PERSONAL_ACCESS_TOKEN --arg "" --arg get_pull_request --arg list_workflow_runs --arg get_job_logs --arg rerun_workflow --arg delete_file --arg create_repository --write >/dev/null 2>&1'
Enter
Type 'REF=$(grep -o "secretRef: .*" .switchboard.yaml | head -1 | awk "{print \$2}")'
Enter
Type 'printf "demo-github-token" | switchboard secrets set "$REF" --value-stdin >/dev/null 2>&1'
Enter
Type 'printf ".switchboard.local.yaml\n" > .gitignore; git add -A; git commit -qm init >/dev/null'
Enter
# The github-ci safety template scopes the pass: reads allowed, rerun gated
# behind approval, deletes and repo administration denied.
Type 'switchboard pass create --from github-ci --profiles github_acme_ci >/dev/null 2>&1'
Enter
# Let the setup commands finish and the clear land before capture resumes,
# otherwise the first visible frame shows the hidden setup backlog.
Sleep 2s
Type 'clear'
Enter
Sleep 1.5s
Show

# ---------- the story ----------
Type "# your agent is on a scoped pass: read CI, rerun behind approval, no deletes."
Enter
Sleep 2.2s

Type "agent github_acme_ci_get_job_logs"
Enter
Sleep 3.2s

Type "# risky-but-legit waits for a human. out of scope does not even get that:"
Enter
Sleep 2s

Type "agent github_acme_ci_rerun_workflow"
Enter
Sleep 3.2s

Type "agent github_acme_ci_delete_file"
Enter
Sleep 4.5s

Type "# stopped before it ever reached GitHub. and it's already on the record:"
Enter
Sleep 2s

Type "switchboard audit verify"
Enter
Sleep 3.5s
