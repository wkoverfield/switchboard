import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  builtInSeatbeltPatterns,
  evaluateSeatbelt,
  resolveSeatbeltPolicy,
  seatbeltAmbientMandateId,
  seatbeltApprovalWindowMs,
  seatbeltCallText,
  seatbeltDenialMessage,
  seatbeltGateId
} from "./seatbelt.js";

const builtInPolicy = {
  enabled: true,
  patterns: [...builtInSeatbeltPatterns]
};

// The false-positive corpus: every entry is a command or MCP call text drawn
// from real dev workflows that the seatbelt must never trip on. A trip on
// any of these is a release blocker, not a tuning item.
const mustNotTrip: string[] = [
  // Vercel preview deploys.
  "vercel",
  "vercel deploy",
  "vercel deploy --prebuilt",
  "vercel env pull .env.local",
  // Convex dev deploys.
  "npx convex dev",
  "convex dev --once",
  "npx convex dev --run init",
  "npx convex run tasks:seed",
  "npx convex dashboard",
  // Stripe TEST-mode keys and calls.
  "stripe trigger payment_intent.succeeded",
  "stripe listen --forward-to localhost:4242/webhook",
  'curl -H "Authorization: Bearer sk_test_abc12345678" https://api.stripe.com/v1/charges',
  "export STRIPE_SECRET_KEY=sk_test_51NxyzABCDEFGH",
  "stripe products list --limit 5",
  // Dev-database drops in QA teardown (destructive SQL is excluded from v1).
  'psql -c "DROP DATABASE the_move_dev"',
  "npx supabase db reset",
  'mysql -e "drop table qa_fixtures"',
  // Force-push to feature branches; plain pushes to main.
  "git push --force origin feat/ambient-seatbelt",
  "git push -f origin fix/hot-fix",
  "git push --force-with-lease origin docs/spec-essay",
  "git push origin main",
  "git push -u origin main",
  "git push origin master",
  "git push --force origin main:not-main",
  "git push --force-with-lease=origin/main origin feature-x",
  "git push --force origin feat/x && git push origin main",
  "git push -f",
  "git push --force origin main-backup",
  "git push origin +feature-x",
  // Read-only DNS and domain commands.
  "vercel dns ls",
  "vercel domains ls",
  "vercel domains inspect wkoverfield.com",
  "aws route53 list-resource-record-sets --hosted-zone-id Z123",
  // Builds and everyday commands that merely mention production.
  "pnpm build",
  "NODE_ENV=production pnpm build",
  "ng build --production",
  "pnpm run deploy:preview",
  "cat docs/production-checklist.md",
  // Routed MCP call texts.
  'switchboard_fixture_echo {"message":"deploy the app"}',
  "vercel_list_deployments",
  'github_findu_create_issue {"title":"ship to production later"}'
];

// The catastrophe corpus: every entry must trip, on both the routed MCP
// evaluation path and the hook script (both call evaluateSeatbelt).
const mustTrip: Array<{ text: string; pattern: string }> = [
  { text: "./deploy --prod --region us-east-1", pattern: "prod-deploy-flag" },
  { text: "npm run deploy -- --production", pattern: "prod-deploy-flag" },
  { text: "vercel deploy --prod --yes", pattern: "prod-deploy-flag" },
  { text: "vercel --prod", pattern: "vercel-prod" },
  { text: "npx convex deploy", pattern: "convex-prod-deploy" },
  { text: "convex deploy -y", pattern: "convex-prod-deploy" },
  {
    text: 'switchboard_fixture_deploy_prod {"message":"x"}',
    pattern: "prod-deploy-tool"
  },
  { text: "./scripts/deploy-prod.sh", pattern: "prod-deploy-tool" },
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
  {
    text: "vercel dns add wkoverfield.com @ A 76.76.21.21",
    pattern: "vercel-dns-mutation"
  },
  { text: "vercel domains buy wkoverfield.dev", pattern: "vercel-domain-mutation" },
  {
    text: "vercel domains transfer-in example.com",
    pattern: "vercel-domain-mutation"
  },
  {
    text: "aws route53 change-resource-record-sets --hosted-zone-id Z1 --change-batch file://x.json",
    pattern: "route53-record-change"
  },
  { text: "git push --force origin main", pattern: "force-push-default-branch" },
  { text: "git push -f origin master", pattern: "force-push-default-branch" },
  { text: "git push origin main --force", pattern: "force-push-default-branch" },
  {
    text: "git push --force-with-lease origin main",
    pattern: "force-push-default-branch"
  },
  {
    text: "git push -f origin HEAD:main",
    pattern: "force-push-default-branch"
  },
  {
    text: "git push origin +main",
    pattern: "force-push-refspec-default-branch"
  },
  {
    text: "git push origin +feat:main",
    pattern: "force-push-refspec-default-branch"
  }
];

describe("seatbelt built-in patterns", () => {
  it.each(mustNotTrip.map((text) => [text]))(
    "does not trip on %s",
    (text) => {
      expect(evaluateSeatbelt(text, builtInPolicy)).toBeUndefined();
    }
  );

  it.each(mustTrip.map((entry) => [entry.text, entry.pattern]))(
    "trips on %s via %s",
    (text, pattern) => {
      const trip = evaluateSeatbelt(text, builtInPolicy);
      expect(trip?.pattern.name).toBe(pattern);
      expect(trip?.gateId).toBe(seatbeltGateId(pattern));
    }
  );

  it("ships exactly the four ruled categories as data with reasons", () => {
    for (const pattern of builtInSeatbeltPatterns) {
      expect(pattern.name.length).toBeGreaterThan(0);
      expect(pattern.reason.length).toBeGreaterThan(0);
      expect(() => new RegExp(pattern.pattern, "i")).not.toThrow();
    }
    expect(builtInSeatbeltPatterns.map((pattern) => pattern.name)).toEqual([
      "prod-deploy-flag",
      "vercel-prod",
      "convex-prod-deploy",
      "prod-deploy-tool",
      "stripe-live-secret-key",
      "stripe-live-mode-flag",
      "vercel-dns-mutation",
      "vercel-domain-mutation",
      "route53-record-change",
      "force-push-default-branch",
      "force-push-refspec-default-branch"
    ]);
  });

  it("never trips when the policy is disabled", () => {
    expect(
      evaluateSeatbelt("git push --force origin main", {
        enabled: false,
        patterns: [...builtInSeatbeltPatterns]
      })
    ).toBeUndefined();
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

  it("defaults to the built-in list when no global config exists", async () => {
    const configHome = await makeConfigHome(null);
    const policy = resolveSeatbeltPolicy({
      env: { XDG_CONFIG_HOME: configHome }
    });
    expect(policy.enabled).toBe(true);
    expect(policy.patterns).toEqual([...builtInSeatbeltPatterns]);
  });

  it("turns off with a top-level seatbelt: off line", async () => {
    const configHome = await makeConfigHome("version: 1\nseatbelt: off\n");
    const policy = resolveSeatbeltPolicy({
      env: { XDG_CONFIG_HOME: configHome }
    });
    expect(policy.enabled).toBe(false);
    expect(policy.patterns).toEqual([]);
  });

  it("turns off with the one-shot disabled flag", async () => {
    const configHome = await makeConfigHome(null);
    const policy = resolveSeatbeltPolicy({
      env: { XDG_CONFIG_HOME: configHome },
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
    expect(policy.patterns.map((pattern) => pattern.name)).not.toContain(
      "route53-record-change"
    );
    expect(
      evaluateSeatbelt("my-cli launch-prod --now", policy)?.pattern.name
    ).toBe("my-launcher");
    expect(
      evaluateSeatbelt("aws route53 change-resource-record-sets", policy)
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
    expect(policy.patterns.map((pattern) => pattern.name)).not.toContain(
      "broken"
    );
  });

  it("keeps built-ins on when the global config is unreadable", async () => {
    const configHome = await makeConfigHome("version: [broken");
    const policy = resolveSeatbeltPolicy({
      env: { XDG_CONFIG_HOME: configHome }
    });
    expect(policy.enabled).toBe(true);
    expect(policy.patterns).toEqual([...builtInSeatbeltPatterns]);
  });
});

describe("seatbeltDenialMessage", () => {
  it("carries the pattern name, reason, approve command, and opt-out", () => {
    const pattern = builtInSeatbeltPatterns[0];
    if (!pattern) {
      throw new Error("built-in patterns are empty");
    }
    const message = seatbeltDenialMessage({
      pattern,
      approvalRequestId: "approval-7"
    });
    expect(message).toContain(`switchboard seatbelt: ${pattern.name}`);
    expect(message).toContain(pattern.reason);
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
