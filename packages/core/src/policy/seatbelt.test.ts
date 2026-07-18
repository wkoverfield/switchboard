import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  builtInSeatbeltRuleNames,
  evaluateSeatbeltMcp,
  evaluateSeatbeltShell,
  resolveSeatbeltPolicy,
  seatbeltAmbientMandateId,
  seatbeltApprovalWindowMs,
  seatbeltCallText,
  seatbeltDenialMessage,
  seatbeltGateId,
  splitStatements,
  type SeatbeltPolicy
} from "./seatbelt.js";

// The built-in denylist with nothing removed and no user additions.
const builtIns: SeatbeltPolicy = {
  enabled: true,
  removedBuiltIns: [],
  userPatterns: [],
  invalidPatterns: [],
  configPath: "/dev/null"
};

// ---------------------------------------------------------------------------
// Shell (Bash hook) corpus
//
// MUST-NOT-TRIP: everyday flows plus the whole "merely mentions a dangerous
// string" reference class the adversarial gate flagged. A trip on any of
// these is a release blocker.
// ---------------------------------------------------------------------------
const shellMustNotTrip: string[] = [
  // Reference class: commands that merely MENTION a dangerous string.
  'git commit -m "fix vercel --prod handling"',
  'git commit -m "block convex deploy"',
  'grep -rn "convex deploy" .',
  'rg "deploy-prod" docs/',
  "cat scripts/deploy-prod.sh",
  "sed -n 1,20p scripts/deploy_prod.sh",
  "chmod +x scripts/deploy-prod.sh",
  "ls deploy_production/",
  'git log --grep="vercel --prod"',
  "git diff main..feature -- scripts/deploy-prod.sh",
  "git show HEAD:scripts/deploy-prod.sh",
  "git status",
  'echo "... git push --force origin main ..." >> notes.md',
  'printf "vercel --prod\\n"',
  "less scripts/deploy-prod.sh",
  "find . -name deploy-prod.sh",
  // Convex preview deploys (F2) and dev.
  "npx convex deploy --preview-create feature-x",
  "convex deploy --preview-name x",
  "npx convex dev",
  "convex dev --once",
  "npx convex run tasks:seed",
  // Vercel: build (F3), preview deploys, read-only subcommands.
  "vercel build --prod",
  "vercel",
  "vercel deploy",
  "vercel deploy --prebuilt",
  "vercel dns ls",
  "vercel domains ls",
  "vercel domains inspect wkoverfield.com",
  "vercel dns inspect wkoverfield.com",
  "vercel env pull .env.local",
  // Stripe test-mode keys and publishable keys.
  'curl -H "Authorization: Bearer sk_test_abc12345678" https://api.stripe.com/v1/charges',
  "export STRIPE_SECRET_KEY=sk_test_51NxyzABCDEFGH",
  "export STRIPE_PUBLISHABLE_KEY=pk_test_51NxyzABCDEFGH",
  "export STRIPE_PUBLISHABLE_KEY=pk_live_51NxyzABCDEFGH",
  "stripe products list --limit 5",
  "stripe listen --forward-to localhost:4242/webhook",
  // Dev-database teardown (destructive SQL is excluded from v1).
  'psql -c "DROP DATABASE the_move_dev"',
  "npx supabase db reset",
  'mysql -e "drop table qa_fixtures"',
  // Force-push to feature branches; plain pushes to main.
  "git push --force origin feature/x",
  "git push -f origin fix/hot-fix",
  "git push --force-with-lease origin feature/x",
  "git push origin main",
  "git push -u origin main",
  "git push origin master",
  "git push --force origin main:not-main",
  "git push --force-with-lease=origin/main origin feature-x",
  "git push --force origin feat/x && git push origin main",
  "git push -f",
  "git push --force origin main-backup",
  "git push origin +feature-x",
  // Builds and everyday commands that mention production.
  "pnpm build",
  "NODE_ENV=production pnpm build",
  "npm install --production",
  "pnpm run deploy:preview",
  "ng build --production",
  // Read-only DNS/domain commands.
  "aws route53 list-resource-record-sets --hosted-zone-id Z123",
  // Non-prod vercel redeploy forms.
  "vercel redeploy dpl_x",
  "vercel redeploy",
  // sh -c payloads whose inner command is read-only.
  'bash -c "grep vercel --prod file"',
  "sh -c 'cat scripts/deploy-prod.sh'",
  // env prefix carrying a read-only command.
  "env FOO=bar grep convex-deploy ."
];

// MUST-TRIP (shell): real irreversible, externally-visible actions.
const shellMustTrip: Array<{ text: string; pattern: string }> = [
  // Generic prod deploy.
  { text: "./deploy --prod --region us-east-1", pattern: "prod-deploy-flag" },
  { text: "npm run deploy -- --production", pattern: "prod-deploy-flag" },
  { text: "yarn deploy --prod", pattern: "prod-deploy-flag" },
  // Vercel prod (F6 spellings).
  { text: "vercel --prod", pattern: "vercel-prod" },
  { text: "vercel deploy --prod", pattern: "vercel-prod" },
  { text: "vercel deploy --prod --yes", pattern: "vercel-prod" },
  { text: "vercel deploy --target=production", pattern: "vercel-prod" },
  { text: "vercel deploy --target production", pattern: "vercel-prod" },
  { text: "npx vercel --prod", pattern: "vercel-prod" },
  { text: "vercel promote dpl_x", pattern: "vercel-prod" },
  {
    text: "vercel alias set my-preview sendthemove.com",
    pattern: "vercel-prod"
  },
  { text: "vercel redeploy --target production", pattern: "vercel-prod" },
  { text: "vercel redeploy dpl_x --prod", pattern: "vercel-prod" },
  // env prefix (with and without assignments) must resolve the real command.
  { text: "env vercel --prod", pattern: "vercel-prod" },
  { text: "env FOO=bar vercel --prod", pattern: "vercel-prod" },
  { text: "env -i vercel --prod", pattern: "vercel-prod" },
  // sh -c / bash -c payload is evaluated as its own command.
  { text: 'bash -c "vercel --prod"', pattern: "vercel-prod" },
  {
    text: "sh -c 'git push --force origin main'",
    pattern: "force-push-default-branch"
  },
  // Convex prod deploy.
  { text: "npx convex deploy", pattern: "convex-prod-deploy" },
  { text: "convex deploy -y", pattern: "convex-prod-deploy" },
  // Stripe live.
  {
    text: "export STRIPE_KEY=sk_live_a1b2c3d4e5f6",
    pattern: "stripe-live-secret-key"
  },
  {
    text: "curl -u rk_live_ABCDEF123456: https://api.stripe.com/v1/charges",
    pattern: "stripe-live-secret-key"
  },
  {
    text: "stripe trigger payment_intent.succeeded --live",
    pattern: "stripe-live-mode-flag"
  },
  // DNS / domains.
  {
    text: "vercel dns add wkoverfield.com @ A 76.76.21.21",
    pattern: "vercel-dns-mutation"
  },
  {
    text: "vercel domains buy wkoverfield.dev",
    pattern: "vercel-domain-mutation"
  },
  {
    text: "vercel domains transfer-in example.com",
    pattern: "vercel-domain-mutation"
  },
  {
    text: "aws route53 change-resource-record-sets --hosted-zone-id Z1 --change-batch file://x.json",
    pattern: "route53-record-change"
  },
  // Force-push to the default branch (F4 refspec, F5 bypasses).
  {
    text: "git push --force origin main",
    pattern: "force-push-default-branch"
  },
  { text: "git push -f origin master", pattern: "force-push-default-branch" },
  {
    text: "git push origin main --force",
    pattern: "force-push-default-branch"
  },
  {
    text: "git push --force-with-lease origin main",
    pattern: "force-push-default-branch"
  },
  {
    text: "git push -f origin HEAD:main",
    pattern: "force-push-default-branch"
  },
  { text: "git push origin +main", pattern: "force-push-default-branch" },
  { text: "git push origin +feat:main", pattern: "force-push-default-branch" },
  {
    text: "git push origin +refs/heads/main",
    pattern: "force-push-default-branch"
  },
  {
    text: "git push --force origin refs/heads/main",
    pattern: "force-push-default-branch"
  },
  {
    text: "git push --force origin HEAD:refs/heads/main",
    pattern: "force-push-default-branch"
  },
  {
    text: "git -C /repo push --force origin main",
    pattern: "force-push-default-branch"
  },
  {
    text: 'git push --force "origin" "main"',
    pattern: "force-push-default-branch"
  },
  {
    text: "git push --mirror origin",
    pattern: "force-push-default-branch"
  }
];

// ---------------------------------------------------------------------------
// MCP (routed tool call) corpus
// ---------------------------------------------------------------------------
const mcpMustNotTrip: Array<{
  toolName: string;
  args?: Record<string, unknown>;
}> = [
  { toolName: "switchboard_fixture_echo", args: { message: "deploy the app" } },
  { toolName: "mcp__vercel__list_deployments" },
  { toolName: "mcp__vercel__get_deployment", args: { id: "dpl_x" } },
  { toolName: "mcp__vercel__deploy_to_vercel", args: { project: "the-move" } },
  { toolName: "mcp__convex__deploy", args: { previewCreate: "feature-x" } },
  { toolName: "mcp__convex__run", args: { functionName: "tasks:seed" } },
  { toolName: "mcp__github__create_issue", args: { title: "ship to prod" } },
  {
    toolName: "mcp__stripe__create_charge",
    args: { key: "sk_test_abc12345678" }
  }
];

const mcpMustTrip: Array<{
  toolName: string;
  args?: Record<string, unknown>;
  pattern: string;
}> = [
  {
    toolName: "switchboard_fixture_deploy_prod",
    args: { message: "x" },
    pattern: "prod-deploy-tool"
  },
  {
    toolName: "github_findu_deploy_prod",
    args: {},
    pattern: "prod-deploy-tool"
  },
  {
    toolName: "mcp__vercel__deploy_to_vercel",
    args: { target: "production" },
    pattern: "vercel-prod"
  },
  {
    toolName: "mcp__convex__deploy",
    args: {},
    pattern: "convex-prod-deploy"
  },
  {
    toolName: "mcp__stripe__create_charge",
    args: { key: "sk_live_ABCDEF123456" },
    pattern: "stripe-live-secret-key"
  }
];

describe("seatbelt shell path", () => {
  it.each(shellMustNotTrip.map((text) => [text]))(
    "does not trip on shell command: %s",
    (text) => {
      expect(evaluateSeatbeltShell(text, builtIns)).toBeUndefined();
    }
  );

  it.each(shellMustTrip.map((entry) => [entry.text, entry.pattern]))(
    "trips on shell command %s via %s",
    (text, pattern) => {
      const trip = evaluateSeatbeltShell(text, builtIns);
      expect(trip?.pattern.name).toBe(pattern);
      expect(trip?.gateId).toBe(seatbeltGateId(pattern));
    }
  );

  it("never trips when the policy is disabled", () => {
    expect(
      evaluateSeatbeltShell("git push --force origin main", {
        ...builtIns,
        enabled: false
      })
    ).toBeUndefined();
  });

  it("evaluates each statement of a compound command independently", () => {
    // Safe first statement, catastrophe second.
    expect(
      evaluateSeatbeltShell("pnpm build && vercel --prod", builtIns)?.pattern
        .name
    ).toBe("vercel-prod");
  });
});

describe("seatbelt MCP path", () => {
  it.each(mcpMustNotTrip.map((entry) => [entry.toolName, entry.args]))(
    "does not trip on MCP tool %s",
    (toolName, args) => {
      expect(
        evaluateSeatbeltMcp(
          toolName as string,
          args as Record<string, unknown> | undefined,
          builtIns
        )
      ).toBeUndefined();
    }
  );

  it.each(
    mcpMustTrip.map((entry) => [entry.toolName, entry.args, entry.pattern])
  )("trips on MCP tool %s via %s", (toolName, args, pattern) => {
    const trip = evaluateSeatbeltMcp(
      toolName as string,
      args as Record<string, unknown> | undefined,
      builtIns
    );
    expect(trip?.pattern.name).toBe(pattern);
  });

  it("keeps prod-deploy-tool off the shell path (matches filenames there)", () => {
    // deploy_prod as a filename in a read command must not trip on shell, but
    // the same token in an MCP tool name must trip.
    expect(
      evaluateSeatbeltShell("cat scripts/deploy_prod.sh", builtIns)
    ).toBeUndefined();
    expect(
      evaluateSeatbeltMcp("some_deploy_prod", {}, builtIns)?.pattern.name
    ).toBe("prod-deploy-tool");
  });
});

describe("seatbelt rule set", () => {
  it("ships the ruled catastrophe categories as named data", () => {
    expect(builtInSeatbeltRuleNames).toEqual([
      "prod-deploy-flag",
      "vercel-prod",
      "convex-prod-deploy",
      "prod-deploy-tool",
      "stripe-live-secret-key",
      "stripe-live-mode-flag",
      "vercel-dns-mutation",
      "vercel-domain-mutation",
      "route53-record-change",
      "force-push-default-branch"
    ]);
  });
});

describe("splitStatements", () => {
  it("splits on unquoted operators and keeps quoted operators intact", () => {
    expect(splitStatements("a && b; c | d")).toEqual(["a", "b", "c", "d"]);
    expect(splitStatements('echo "a && b"')).toEqual(['echo "a && b"']);
  });
});

describe("seatbeltCallText", () => {
  it("joins tool name and JSON arguments", () => {
    expect(seatbeltCallText("deploy_prod", { target: "eu" })).toBe(
      'deploy_prod {"target":"eu"}'
    );
  });

  it("uses the bare tool name for empty arguments", () => {
    expect(seatbeltCallText("echo", undefined)).toBe("echo");
    expect(seatbeltCallText("echo", {})).toBe("echo");
  });
});

describe("resolveSeatbeltPolicy", () => {
  async function makeConfigHome(content: string | null): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "switchboard-seatbelt-"));
    if (content !== null) {
      await mkdir(join(root, "switchboard"), { recursive: true });
      await writeFile(join(root, "switchboard", "config.yaml"), content);
    }
    return root;
  }

  it("defaults to the full built-in list when no global config exists", () => {
    const policy = resolveSeatbeltPolicy({
      env: { XDG_CONFIG_HOME: "/dev/null/missing" }
    });
    expect(policy.enabled).toBe(true);
    expect(policy.removedBuiltIns).toEqual([]);
    expect(policy.userPatterns).toEqual([]);
  });

  it("turns off with a top-level seatbelt: off line", async () => {
    const configHome = await makeConfigHome("version: 1\nseatbelt: off\n");
    const policy = resolveSeatbeltPolicy({
      env: { XDG_CONFIG_HOME: configHome }
    });
    expect(policy.enabled).toBe(false);
    expect(
      evaluateSeatbeltShell("git push --force origin main", policy)
    ).toBeUndefined();
  });

  it("turns off with the one-shot disabled flag", () => {
    const policy = resolveSeatbeltPolicy({
      env: { XDG_CONFIG_HOME: "/dev/null/missing" },
      disabled: true
    });
    expect(policy.enabled).toBe(false);
  });

  it("extends and trims through policies.default.seatbelt", async () => {
    const configHome = await makeConfigHome(
      [
        "version: 1",
        "policies:",
        "  default:",
        "    seatbelt:",
        "      add:",
        "        - name: my-launcher",
        '          pattern: "\\\\bmy-cli\\\\s+launch-prod\\\\b"',
        '          reason: "launches production"',
        "      remove:",
        "        - route53-record-change",
        ""
      ].join("\n")
    );
    const policy = resolveSeatbeltPolicy({
      env: { XDG_CONFIG_HOME: configHome }
    });
    expect(policy.removedBuiltIns).toContain("route53-record-change");
    expect(policy.userPatterns.map((pattern) => pattern.name)).toEqual([
      "my-launcher"
    ]);
    // User pattern trips on shell, respecting the read-only-verb guard.
    expect(
      evaluateSeatbeltShell("my-cli launch-prod --now", policy)?.pattern.name
    ).toBe("my-launcher");
    expect(
      evaluateSeatbeltShell('echo "my-cli launch-prod"', policy)
    ).toBeUndefined();
    // Removed built-in no longer fires.
    expect(
      evaluateSeatbeltShell(
        "aws route53 change-resource-record-sets --x y",
        policy
      )
    ).toBeUndefined();
  });

  it("skips user patterns whose regex does not compile", async () => {
    const configHome = await makeConfigHome(
      [
        "version: 1",
        "policies:",
        "  default:",
        "    seatbelt:",
        "      add:",
        "        - name: broken",
        '          pattern: "([unclosed"',
        '          reason: "broken"',
        ""
      ].join("\n")
    );
    const policy = resolveSeatbeltPolicy({
      env: { XDG_CONFIG_HOME: configHome }
    });
    expect(policy.invalidPatterns).toEqual(["broken"]);
    expect(policy.userPatterns).toEqual([]);
  });

  it("keeps built-ins on when the global config is unreadable", async () => {
    const configHome = await makeConfigHome("version: [broken");
    const policy = resolveSeatbeltPolicy({
      env: { XDG_CONFIG_HOME: configHome }
    });
    expect(policy.enabled).toBe(true);
    expect(policy.removedBuiltIns).toEqual([]);
    expect(
      evaluateSeatbeltShell("git push --force origin main", policy)?.pattern
        .name
    ).toBe("force-push-default-branch");
  });
});

describe("seatbeltDenialMessage", () => {
  it("carries the pattern name, reason, approve command, and opt-out", () => {
    const message = seatbeltDenialMessage({
      pattern: {
        name: "vercel-prod",
        pattern: "vercel deploy --prod",
        reason: "Vercel production deploy"
      },
      approvalRequestId: "approval-7"
    });
    expect(message).toContain("switchboard seatbelt: vercel-prod");
    expect(message).toContain("Vercel production deploy");
    expect(message).toContain(
      'switchboard approve approval-7 --reason "<why this is safe>"'
    );
    expect(message).toContain('"seatbelt: off"');
  });
});

describe("seatbelt constants", () => {
  it("keeps the documented ambient approval identity and window", () => {
    expect(seatbeltAmbientMandateId).toBe("seatbelt");
    expect(seatbeltApprovalWindowMs).toBe(15 * 60_000);
  });
});
