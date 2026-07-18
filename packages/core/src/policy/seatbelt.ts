import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  resolveGlobalConfigPath,
  type PathResolutionOptions
} from "../config/paths.js";
import {
  seatbeltPatternSchema,
  seatbeltSettingsSchema,
  type SeatbeltPattern
} from "../schemas/config.js";

export type { SeatbeltPattern } from "../schemas/config.js";

/**
 * Approval requests created for seatbelt trips with no bound pass are keyed
 * under this synthetic mandate id, so `switchboard approve` and the audit
 * log have a stable identity for ambient (pass-less) denials.
 */
export const seatbeltAmbientMandateId = "seatbelt";

/**
 * How long an approved ambient seatbelt request stays usable. An approval
 * covers retries of the same pattern and tool until it expires; trips under
 * an active pass use the pass's own expiry instead.
 */
export const seatbeltApprovalWindowMs = 15 * 60_000;

/** Approval gate id for a seatbelt pattern, e.g. `seatbelt:vercel-prod`. */
export function seatbeltGateId(patternName: string): string {
  return `seatbelt:${patternName}`;
}

// Statement boundary: patterns never match across `&&`, `||`, `;`, `|`, or
// newlines, so `git push --force origin feat/x && echo main` does not read
// as a force-push of main.
const withinStatement = String.raw`[^&|;\n]*`;

/**
 * The shipped catastrophe denylist. Curation rule: IRREVERSIBLE and
 * EXTERNALLY VISIBLE only, encoded tightly enough that everyday dev flows
 * (preview deploys, dev deploys, test-mode payment calls, dev database
 * teardown, force-push to feature branches) never match. Users extend with
 * `policies.default.seatbelt.add` and trim with
 * `policies.default.seatbelt.remove` in the machine-level global config.
 */
export const builtInSeatbeltPatterns: readonly SeatbeltPattern[] = [
  {
    name: "prod-deploy-flag",
    pattern: String.raw`\bdeploy\b${withinStatement}\s--prod(uction)?\b`,
    reason: "deploy command explicitly targeting production"
  },
  {
    name: "vercel-prod",
    pattern: String.raw`\bvercel\b${withinStatement}\s--prod(uction)?\b`,
    reason: "Vercel production deploy (previews deploy without --prod)"
  },
  {
    name: "convex-prod-deploy",
    pattern: String.raw`\bconvex\s+deploy\b`,
    reason:
      "convex deploy pushes to the production deployment (npx convex dev pushes to dev)"
  },
  {
    name: "prod-deploy-tool",
    // No leading word boundary: namespaced MCP tool names join with
    // underscores (switchboard_fixture_deploy_prod), and "_" is a word
    // character.
    pattern: String.raw`deploy[-_]prod(uction)?\b`,
    reason: "production deploy tool call"
  },
  {
    name: "stripe-live-secret-key",
    pattern: String.raw`\b[rs]k_live_[A-Za-z0-9]{8,}`,
    reason: "Stripe live-mode secret key moves real money (test keys are sk_test_...)"
  },
  {
    name: "stripe-live-mode-flag",
    pattern: String.raw`\bstripe\b${withinStatement}\s--live\b`,
    reason: "Stripe CLI live mode operates on real payments"
  },
  {
    name: "vercel-dns-mutation",
    pattern: String.raw`\bvercel\s+dns\s+(add|rm|import)\b`,
    reason: "DNS record mutation is externally visible and slow to undo"
  },
  {
    name: "vercel-domain-mutation",
    pattern: String.raw`\bvercel\s+domains\s+(add|rm|buy|move|transfer[-_]?in)\b`,
    reason: "domain registration or transfer is externally visible and slow to undo"
  },
  {
    name: "route53-record-change",
    pattern: String.raw`\bchange-resource-record-sets\b`,
    reason: "Route 53 DNS record mutation is externally visible and slow to undo"
  },
  {
    name: "force-push-default-branch",
    pattern: String.raw`\bgit\s+push\b(?=${withinStatement}\s(?:--force(?:-with-lease(?:=\S+)?)?|-f)(?:\s|$))${withinStatement}[\s:](?:main|master)(?:\s|$)`,
    reason: "force-push rewrites the default branch history for everyone"
  },
  {
    name: "force-push-refspec-default-branch",
    pattern: String.raw`\bgit\s+push\b${withinStatement}\s\+(?:\S*:)?(?:main|master)(?:\s|$)`,
    reason: "a + refspec force-pushes the default branch history for everyone"
  }
];

export interface SeatbeltPolicy {
  enabled: boolean;
  patterns: SeatbeltPattern[];
  /** Names of user-supplied patterns whose regex failed to compile. */
  invalidPatterns: string[];
  /** The global config path the policy was read from. */
  configPath: string;
}

export interface ResolveSeatbeltPolicyOptions extends PathResolutionOptions {
  /** One-shot disable, e.g. from a `--no-seatbelt` flag. */
  disabled?: boolean;
}

/**
 * Resolve the live seatbelt policy from the machine-level global config
 * ONLY. Repo config is deliberately not consulted: a writable
 * `.switchboard.yaml` must not be able to switch the floor off or trim
 * patterns. A missing or unreadable global config resolves to the built-in
 * defaults with the seatbelt on (fail safe).
 */
export function resolveSeatbeltPolicy(
  options: ResolveSeatbeltPolicyOptions = {}
): SeatbeltPolicy {
  const configPath = resolveGlobalConfigPath(options);
  if (options.disabled) {
    return {
      enabled: false,
      patterns: [],
      invalidPatterns: [],
      configPath
    };
  }

  let parsed: Record<string, unknown> = {};
  try {
    const raw = readFileSync(configPath, "utf8");
    const yaml: unknown = raw.trim().length === 0 ? {} : parseYaml(raw);
    if (isRecord(yaml)) {
      parsed = yaml;
    }
  } catch {
    // Missing or unreadable global config: built-in defaults stay on.
  }

  if (parsed.seatbelt === "off" || parsed.seatbelt === false) {
    return {
      enabled: false,
      patterns: [],
      invalidPatterns: [],
      configPath
    };
  }

  const settings = seatbeltSettingsFromConfig(parsed);
  const removed = new Set(settings.remove);
  const patterns: SeatbeltPattern[] = builtInSeatbeltPatterns.filter(
    (pattern) => !removed.has(pattern.name)
  );
  const invalidPatterns: string[] = [];
  for (const added of settings.add) {
    if (compileSeatbeltPattern(added.pattern) === undefined) {
      invalidPatterns.push(added.name);
      continue;
    }
    patterns.push(added);
  }

  return { enabled: true, patterns, invalidPatterns, configPath };
}

function seatbeltSettingsFromConfig(parsed: Record<string, unknown>): {
  add: SeatbeltPattern[];
  remove: string[];
} {
  const policies = isRecord(parsed.policies) ? parsed.policies : {};
  const defaultPolicy = isRecord(policies.default) ? policies.default : {};
  const result = seatbeltSettingsSchema.safeParse(defaultPolicy.seatbelt ?? {});
  if (!result.success) {
    // A malformed stanza never widens the floor: built-ins apply unchanged.
    return { add: [], remove: [] };
  }

  const add: SeatbeltPattern[] = [];
  for (const candidate of result.data.add) {
    const pattern = seatbeltPatternSchema.safeParse(candidate);
    if (pattern.success) {
      add.push(pattern.data);
    }
  }

  return { add, remove: result.data.remove };
}

export interface SeatbeltTrip {
  pattern: SeatbeltPattern;
  gateId: string;
}

/**
 * The single text form both enforcement surfaces evaluate: MCP calls as
 * `<tool name> <JSON args>`, harness shell hooks as the raw command string.
 */
export function seatbeltCallText(
  toolName: string,
  args: Record<string, unknown> | undefined
): string {
  return args === undefined || Object.keys(args).length === 0
    ? toolName
    : `${toolName} ${JSON.stringify(args)}`;
}

/** First matching pattern wins; invalid regexes never match. */
export function evaluateSeatbelt(
  callText: string,
  policy: Pick<SeatbeltPolicy, "enabled" | "patterns">
): SeatbeltTrip | undefined {
  if (!policy.enabled) {
    return undefined;
  }

  for (const pattern of policy.patterns) {
    const regex = compileSeatbeltPattern(pattern.pattern);
    if (regex?.test(callText)) {
      return { pattern, gateId: seatbeltGateId(pattern.name) };
    }
  }

  return undefined;
}

/**
 * The denial text shown to the agent on a seatbelt trip. Carries the
 * pattern name, the reason, the exact approve command, and the opt-out, so
 * a blocked loop can recover without a human hunting through docs. Both the
 * routed MCP path and the harness hook use this wording.
 */
export function seatbeltDenialMessage(options: {
  pattern: SeatbeltPattern;
  approvalRequestId?: string;
}): string {
  const parts = [
    `switchboard seatbelt: ${options.pattern.name}`,
    options.pattern.reason
  ];
  if (options.approvalRequestId) {
    parts.push(
      `approval request ${options.approvalRequestId} is pending`,
      `approve with: switchboard approve ${options.approvalRequestId} --reason "<why this is safe>"`,
      "then retry the same call"
    );
  }
  parts.push(
    'or disable the seatbelt with "seatbelt: off" in ~/.config/switchboard/config.yaml'
  );
  return parts.join("; ");
}

function compileSeatbeltPattern(source: string): RegExp | undefined {
  try {
    return new RegExp(source, "i");
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
