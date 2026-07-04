# Switchboard hero demo for VHS (https://github.com/charmbracelet/vhs).
#
#   brew install vhs          # one-time
#   pnpm build                # build the CLI once
#   vhs examples/switchboard.tape   # run from REPO ROOT -> writes examples/switchboard.gif
#
# ~17s "watch it work": an agent in this repo can reach every tool and token,
# then gets put on a scoped pass that expires on its own. The colored
# PASS GRANTED badge is the hero frame.

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
Type 'D=$(mktemp -d); mkdir -p "$D/acme-app"; cd "$D/acme-app"; export XDG_STATE_HOME="$D/state"'
Enter
Type 'switchboard(){ node "$SB" "$@"; }'
Enter
Type 'git init -q -b main; git config user.email demo@local; git config user.name demo'
Enter
Type 'cp "$ROOT/examples/demo-repo.switchboard.yaml" .switchboard.yaml'
Enter
Type 'printf ".switchboard.local.yaml\n" > .gitignore; git add -A; git commit -qm init >/dev/null'
Enter
# route a client so the pass actually enforces (the real happy path).
Type 'switchboard install claude --write >/dev/null 2>&1'
Enter
Type 'clear'
Enter
Show

# ---------- the story ----------
Type "# your AI agent can reach every tool and token in this repo."
Enter
Sleep 1.6s
Type "switchboard grant --for 4h"
Enter
Sleep 4s
Type "# everything not listed is denied. secrets stay in your keychain."
Enter
Sleep 2.2s
Type "switchboard revoke"
Enter
Sleep 2.6s
