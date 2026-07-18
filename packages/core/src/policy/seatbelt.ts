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

// ---------------------------------------------------------------------------
// Rule model
//
// The seatbelt has two distinct enforcement surfaces that must not be
// conflated:
//
//   - SHELL (the Claude Code Bash hook): the raw command line. Substring
//     matching here is wrong: `git commit -m "fix vercel --prod"`,
//     `grep -rn "convex deploy" .`, and `cat scripts/deploy-prod.sh` all
//     merely MENTION a dangerous string. So the shell path parses the line
//     into statements, identifies the invoked command of each, hard-excludes
//     read-only and metadata verbs, and only evaluates deploy/push rules when
//     the invoked command actually IS that tool.
//   - MCP (the routed tool call): the namespaced tool name plus JSON
//     arguments. Deploy MCP tools are matched by tool name, not shell syntax.
//
// A rule may participate in either or both surfaces.
// ---------------------------------------------------------------------------

interface StatementContext {
  /** The raw statement text (one command, quotes intact). */
  text: string;
  /** Tokens with env assignments removed and quotes stripped. */
  argv: string[];
  /** Basename of the invoked command, lowercased (e.g. "git", "vercel"). */
  verb: string;
  /** Resolved tool through package runners (npx/pnpm/yarn), basename. */
  tool: string;
  /** Arguments to the resolved tool. */
  toolArgs: string[];
}

interface SeatbeltRule {
  name: string;
  reason: string;
  /** Human-readable descriptor recorded as the approval gate pattern. */
  descriptor: string;
  /** Shell path: trips when the invoked command matches this rule. */
  shellCommand?: (ctx: StatementContext) => boolean;
  /**
   * Shell path: a text match against the statement, reached only after the
   * read-only-verb guard. Used for rules where the dangerous token is the
   * payload itself (a live secret key) rather than a subcommand.
   */
  shellText?: RegExp;
  /** MCP path: trips against the tool name and call text. */
  mcp?: (ctx: { toolName: string; callText: string }) => boolean;
}

// Read-only and metadata commands can never trip: they observe or annotate,
// they do not act. Keyed by basename. `git` is handled separately (safe
// unless the subcommand is `push`).
const readOnlyVerbs = new Set([
  "cat",
  "bat",
  "tac",
  "nl",
  "less",
  "more",
  "head",
  "tail",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ripgrep",
  "ag",
  "ack",
  "sed",
  "awk",
  "cut",
  "sort",
  "uniq",
  "wc",
  "tr",
  "ls",
  "tree",
  "find",
  "fd",
  "stat",
  "file",
  "du",
  "df",
  "pwd",
  "cd",
  "echo",
  "printf",
  "print",
  "chmod",
  "chown",
  "man",
  "which",
  "whereis",
  "type",
  "diff",
  "vim",
  "nvim",
  "vi",
  "nano",
  "emacs",
  "code",
  "subl",
  "open",
  "tee",
  "true",
  "false",
  "test"
]);

const packageRunners = new Set([
  "npx",
  "pnpm",
  "pnpx",
  "yarn",
  "bun",
  "bunx",
  "npm",
  "deno"
]);

const runnerSkipTokens = new Set([
  "run",
  "dlx",
  "exec",
  "-y",
  "--yes",
  "-s",
  "--silent",
  "--quiet",
  "-q"
]);

const knownVercelSubcommands = new Set([
  "deploy",
  "build",
  "dev",
  "promote",
  "redeploy",
  "rollback",
  "alias",
  "dns",
  "domains",
  "env",
  "ls",
  "list",
  "inspect",
  "logs",
  "link",
  "pull",
  "whoami",
  "login",
  "logout",
  "git",
  "certs",
  "secrets",
  "teams",
  "projects",
  "bisect"
]);

/**
 * The shipped catastrophe denylist. Curation rule: IRREVERSIBLE and
 * EXTERNALLY VISIBLE only. On the shell surface a rule fires only when the
 * invoked command actually is the named tool, so everyday flows that merely
 * mention a dangerous string (a commit message, a grep, a filename) never
 * trip. Users extend with `policies.default.seatbelt.add` and trim by name
 * with `policies.default.seatbelt.remove` in the machine-level global config.
 */
export const builtInSeatbeltRules: readonly SeatbeltRule[] = [
  {
    name: "prod-deploy-flag",
    reason: "deploy command explicitly targeting production",
    descriptor: "<deploy tool> --prod",
    shellCommand: (ctx) =>
      isDeployTool(ctx.tool) && hasProductionFlag(ctx.toolArgs)
  },
  {
    name: "vercel-prod",
    reason: "Vercel production deploy, promotion, or alias to a live domain",
    descriptor: "vercel deploy/promote/alias --prod",
    shellCommand: (ctx) => tripsVercelProd(ctx),
    mcp: ({ toolName, callText }) =>
      /mcp__vercel__\w*deploy/i.test(toolName) &&
      /(?:"?target"?|environment)\W+(?:production|prod)\b/i.test(callText)
  },
  {
    name: "convex-prod-deploy",
    reason:
      "convex deploy pushes to the production deployment (npx convex dev and --preview-create push to non-prod)",
    descriptor: "convex deploy (no --preview-create)",
    shellCommand: (ctx) => tripsConvexProdDeploy(ctx),
    mcp: ({ toolName, callText }) =>
      /mcp__convex__deploy\b/i.test(toolName) && !/preview/i.test(callText)
  },
  {
    name: "prod-deploy-tool",
    reason: "production deploy tool call",
    descriptor: "deploy_prod tool name",
    // MCP tool-name path ONLY. On raw shell this matches filenames like
    // deploy-prod.sh, so it must never run there.
    mcp: ({ toolName }) =>
      /(?:^|[^a-z0-9])(?:deploy[-_]prod(?:uction)?|prod(?:uction)?[-_]deploy)/i.test(
        toolName
      )
  },
  {
    name: "stripe-live-secret-key",
    reason:
      "Stripe live-mode secret key moves real money (test keys are sk_test_...)",
    descriptor: "sk_live_/rk_live_ secret key",
    shellText: /\b[rs]k_live_[A-Za-z0-9]{8,}/,
    mcp: ({ callText }) => /\b[rs]k_live_[A-Za-z0-9]{8,}/.test(callText)
  },
  {
    name: "stripe-live-mode-flag",
    reason: "Stripe CLI live mode operates on real payments",
    descriptor: "stripe --live",
    shellCommand: (ctx) =>
      ctx.tool === "stripe" && ctx.toolArgs.includes("--live")
  },
  {
    name: "vercel-dns-mutation",
    reason: "DNS record mutation is externally visible and slow to undo",
    descriptor: "vercel dns add/rm/import",
    shellCommand: (ctx) =>
      ctx.tool === "vercel" &&
      firstKnownVercelSub(ctx.toolArgs) === "dns" &&
      isMutationVerb(positionalAfter(ctx.toolArgs, "dns"), [
        "add",
        "rm",
        "remove",
        "import"
      ])
  },
  {
    name: "vercel-domain-mutation",
    reason:
      "domain registration or transfer is externally visible and slow to undo",
    descriptor: "vercel domains add/rm/buy/move/transfer-in",
    shellCommand: (ctx) =>
      ctx.tool === "vercel" &&
      firstKnownVercelSub(ctx.toolArgs) === "domains" &&
      isMutationVerb(positionalAfter(ctx.toolArgs, "domains"), [
        "add",
        "rm",
        "remove",
        "buy",
        "move",
        "transfer-in",
        "transfer"
      ])
  },
  {
    name: "route53-record-change",
    reason:
      "Route 53 DNS record mutation is externally visible and slow to undo",
    descriptor: "change-resource-record-sets",
    shellCommand: (ctx) =>
      ctx.tool === "aws" &&
      ctx.toolArgs.includes("change-resource-record-sets")
  },
  {
    name: "force-push-default-branch",
    reason: "force-push rewrites the default branch history for everyone",
    descriptor: "git push --force <default-branch>",
    shellCommand: (ctx) => tripsForcePushDefaultBranch(ctx)
  }
];

export const builtInSeatbeltRuleNames: readonly string[] =
  builtInSeatbeltRules.map((rule) => rule.name);

export interface SeatbeltPolicy {
  enabled: boolean;
  /** Built-in rule names removed via `policies.default.seatbelt.remove`. */
  removedBuiltIns: string[];
  /** User-supplied regex patterns added via `policies.default.seatbelt.add`. */
  userPatterns: SeatbeltPattern[];
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
  const off = (): SeatbeltPolicy => ({
    enabled: false,
    removedBuiltIns: [],
    userPatterns: [],
    invalidPatterns: [],
    configPath
  });

  if (options.disabled) {
    return off();
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
    return off();
  }

  const settings = seatbeltSettingsFromConfig(parsed);
  const userPatterns: SeatbeltPattern[] = [];
  const invalidPatterns: string[] = [];
  for (const added of settings.add) {
    if (compileSeatbeltPattern(added.pattern) === undefined) {
      invalidPatterns.push(added.name);
      continue;
    }
    userPatterns.push(added);
  }

  return {
    enabled: true,
    removedBuiltIns: settings.remove,
    userPatterns,
    invalidPatterns,
    configPath
  };
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
 * The single text form the MCP surface evaluates: `<tool name> <JSON args>`.
 */
export function seatbeltCallText(
  toolName: string,
  args: Record<string, unknown> | undefined
): string {
  return args === undefined || Object.keys(args).length === 0
    ? toolName
    : `${toolName} ${JSON.stringify(args)}`;
}

function activeRules(policy: SeatbeltPolicy): SeatbeltRule[] {
  const removed = new Set(policy.removedBuiltIns);
  return builtInSeatbeltRules.filter((rule) => !removed.has(rule.name));
}

function tripFromRule(rule: SeatbeltRule): SeatbeltTrip {
  return {
    pattern: {
      name: rule.name,
      pattern: rule.descriptor,
      reason: rule.reason
    },
    gateId: seatbeltGateId(rule.name)
  };
}

function tripFromUserPattern(pattern: SeatbeltPattern): SeatbeltTrip {
  return { pattern, gateId: seatbeltGateId(pattern.name) };
}

// Depth cap for `sh -c "..."` recursion, so a pathologically nested payload
// (bash -c "bash -c ...") cannot spin the evaluator.
const maxShellRecursionDepth = 4;

/**
 * Evaluate a raw shell command (the Claude Code Bash hook surface). The
 * command is split into statements; each statement's invoked command is
 * identified; read-only and metadata commands never trip; deploy/push rules
 * fire only when the invoked command actually is that tool. A `sh -c`/
 * `bash -c` payload string is evaluated as its own nested command through the
 * same matcher. First match wins.
 */
export function evaluateSeatbeltShell(
  command: string,
  policy: SeatbeltPolicy,
  depth = 0
): SeatbeltTrip | undefined {
  if (!policy.enabled) {
    return undefined;
  }

  const rules = activeRules(policy);
  for (const statement of splitStatements(command)) {
    const ctx = statementContext(statement);

    // Recurse into a shell-c payload so `bash -c "vercel --prod"` is evaluated
    // as the command it runs. The wrapper statement itself is not a
    // catastrophe, so a non-tripping payload just falls through.
    const payload = depth < maxShellRecursionDepth ? shellDashCPayload(ctx) : undefined;
    if (payload !== undefined) {
      const nested = evaluateSeatbeltShell(payload, policy, depth + 1);
      if (nested) {
        return nested;
      }
      continue;
    }

    if (ctx.argv.length === 0 || isReadOnlyStatement(ctx)) {
      continue;
    }

    for (const rule of rules) {
      if (rule.shellCommand?.(ctx)) {
        return tripFromRule(rule);
      }
      if (rule.shellText?.test(ctx.text)) {
        return tripFromRule(rule);
      }
    }

    for (const pattern of policy.userPatterns) {
      const regex = compileSeatbeltPattern(pattern.pattern);
      if (regex?.test(ctx.text)) {
        return tripFromUserPattern(pattern);
      }
    }
  }

  return undefined;
}

const shellInterpreters = new Set(["sh", "bash", "zsh", "dash", "ash", "ksh"]);

// The string argument of `sh -c <payload>` (and combined short flags like
// `-lc`), or undefined when the statement is not a shell -c invocation.
function shellDashCPayload(ctx: StatementContext): string | undefined {
  if (!shellInterpreters.has(ctx.verb)) {
    return undefined;
  }

  for (let i = 1; i < ctx.argv.length; i += 1) {
    const token = ctx.argv[i];
    if (token === "-c" || /^-[a-z]*c$/.test(token ?? "")) {
      return ctx.argv[i + 1];
    }
  }

  return undefined;
}

/**
 * Evaluate a routed MCP tool call. Deploy tools are matched by tool name and
 * arguments, never by shell syntax. First match wins.
 */
export function evaluateSeatbeltMcp(
  toolName: string,
  args: Record<string, unknown> | undefined,
  policy: SeatbeltPolicy
): SeatbeltTrip | undefined {
  if (!policy.enabled) {
    return undefined;
  }

  const callText = seatbeltCallText(toolName, args);
  for (const rule of activeRules(policy)) {
    if (rule.mcp?.({ toolName, callText })) {
      return tripFromRule(rule);
    }
  }

  for (const pattern of policy.userPatterns) {
    const regex = compileSeatbeltPattern(pattern.pattern);
    if (regex?.test(callText)) {
      return tripFromUserPattern(pattern);
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

// ---------------------------------------------------------------------------
// Shell parsing
// ---------------------------------------------------------------------------

/**
 * Split a command line into individual statements on unquoted `&&`, `||`,
 * `|`, `;`, `&`, and newline. Operators inside single or double quotes are
 * ignored, so `echo "a && b"` is one statement.
 */
export function splitStatements(command: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    const next = command[i + 1];

    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "\n" || char === ";") {
      statements.push(current);
      current = "";
      continue;
    }

    if ((char === "&" || char === "|") && next === char) {
      statements.push(current);
      current = "";
      i += 1;
      continue;
    }

    if (char === "|" || char === "&") {
      statements.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  statements.push(current);
  return statements.map((statement) => statement.trim()).filter(Boolean);
}

function statementContext(statement: string): StatementContext {
  const rawTokens = tokenize(statement);
  const argv = stripLeadingEnvAndPrefixes(rawTokens);
  const verb = argv.length > 0 ? baseName(argv[0] ?? "") : "";
  const { tool, toolArgs } = resolveInvocation(argv);
  return { text: statement, argv, verb, tool, toolArgs };
}

function tokenize(statement: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasToken = false;

  for (let i = 0; i < statement.length; i += 1) {
    const char = statement[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      hasToken = true;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }

    if (char === " " || char === "\t") {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }

    current += char;
    hasToken = true;
  }

  if (hasToken) {
    tokens.push(current);
  }

  return tokens;
}

// Drop leading `VAR=value` env assignments and pass-through prefixes so the
// invoked command is the real one: `NODE_ENV=production pnpm build` -> pnpm,
// `env FOO=bar vercel --prod` -> vercel. Once a prefix has been consumed,
// its own option flags are skipped too (e.g. `env -i`, `sudo -E`).
function stripLeadingEnvAndPrefixes(tokens: string[]): string[] {
  let index = 0;
  let strippedPrefix = false;
  const prefixes = new Set([
    "sudo",
    "command",
    "nohup",
    "nice",
    "time",
    "env"
  ]);

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) {
      break;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1;
      continue;
    }
    if (prefixes.has(baseName(token))) {
      index += 1;
      strippedPrefix = true;
      continue;
    }
    // A flag after a consumed prefix belongs to that prefix (env -i, sudo -E),
    // not to the real command; real commands never start with a dash.
    if (strippedPrefix && token.startsWith("-")) {
      index += 1;
      continue;
    }
    break;
  }

  return tokens.slice(index);
}

// Resolve the real tool through a package runner (npx/pnpm/yarn/...), so
// `npx convex deploy` resolves to tool "convex" with args ["deploy"].
function resolveInvocation(argv: string[]): {
  tool: string;
  toolArgs: string[];
} {
  if (argv.length === 0) {
    return { tool: "", toolArgs: [] };
  }

  const verb = baseName(argv[0] ?? "");
  if (!packageRunners.has(verb)) {
    return { tool: baseName(argv[0] ?? ""), toolArgs: argv.slice(1) };
  }

  let index = 1;
  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined) {
      break;
    }
    if (runnerSkipTokens.has(token) || token.startsWith("-")) {
      index += 1;
      continue;
    }
    break;
  }

  const toolToken = argv[index];
  if (toolToken === undefined) {
    return { tool: verb, toolArgs: [] };
  }

  return { tool: baseName(toolToken), toolArgs: argv.slice(index + 1) };
}

function isReadOnlyStatement(ctx: StatementContext): boolean {
  if (readOnlyVerbs.has(ctx.verb)) {
    return true;
  }

  if (ctx.verb === "git") {
    // Only `git push` can reach a catastrophe rule; every other git command
    // (commit, log, diff, show, status, ...) is metadata or local-only.
    return gitSubcommand(ctx.argv) !== "push";
  }

  return false;
}

function gitSubcommand(argv: string[]): string | undefined {
  // Global options that take a separate value must skip that value too.
  const valueOptions = new Set([
    "-C",
    "-c",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--exec-path",
    "--config-env"
  ]);

  let index = 1;
  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined) {
      break;
    }
    if (!token.startsWith("-")) {
      return token;
    }
    if (valueOptions.has(token) && !token.includes("=")) {
      index += 2;
      continue;
    }
    index += 1;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Rule predicates
// ---------------------------------------------------------------------------

function isDeployTool(tool: string): boolean {
  return /(?:^|\/)deploy(?:[.:_-]|$)/.test(tool);
}

function hasProductionFlag(args: string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--prod" || token === "--production") {
      return true;
    }
    if (/^--target=(?:production|prod)$/.test(token ?? "")) {
      return true;
    }
    if (token === "--target") {
      const value = args[i + 1];
      if (value === "production" || value === "prod") {
        return true;
      }
    }
    if (/^--environment=(?:production|prod)$/.test(token ?? "")) {
      return true;
    }
    if (token === "--environment") {
      const value = args[i + 1];
      if (value === "production" || value === "prod") {
        return true;
      }
    }
  }

  return false;
}

function tripsVercelProd(ctx: StatementContext): boolean {
  if (ctx.tool !== "vercel") {
    return false;
  }

  const sub = firstKnownVercelSub(ctx.toolArgs);
  if (sub === "build" || sub === "dev") {
    // `vercel build` only produces local artifacts; it deploys nothing.
    return false;
  }
  if (sub === "promote") {
    return true;
  }
  if (sub === "alias") {
    return positionalAfter(ctx.toolArgs, "alias") === "set";
  }
  // `redeploy` re-runs an existing deployment; a production target makes it a
  // prod deploy, so it is gated exactly like `deploy`.
  if (sub === undefined || sub === "deploy" || sub === "redeploy") {
    return hasProductionFlag(ctx.toolArgs);
  }

  return false;
}

function tripsConvexProdDeploy(ctx: StatementContext): boolean {
  if (ctx.tool !== "convex") {
    return false;
  }
  if (firstPositional(ctx.toolArgs) !== "deploy") {
    return false;
  }
  // `--preview-create <name>` / `--preview-name <name>` deploy to a per-branch
  // preview backend, the Convex analogue of a Vercel preview, not production.
  return !ctx.toolArgs.some(
    (token) =>
      token === "--preview-create" ||
      token === "--preview-name" ||
      token.startsWith("--preview-create=") ||
      token.startsWith("--preview-name=")
  );
}

function tripsForcePushDefaultBranch(ctx: StatementContext): boolean {
  if (ctx.verb !== "git" || gitSubcommand(ctx.argv) !== "push") {
    return false;
  }

  const pushArgs = argsAfterGitSubcommand(ctx.argv);
  // `--mirror` force-updates every ref, including the default branch.
  if (pushArgs.includes("--mirror")) {
    return true;
  }

  const forceFlag = pushArgs.some(
    (token) =>
      token === "--force" ||
      token === "-f" ||
      token === "--force-with-lease" ||
      token === "--force-if-includes" ||
      token.startsWith("--force-with-lease=")
  );

  const positionals = pushArgs.filter((token) => !token.startsWith("-"));
  // The first positional after `push` is the remote; the rest are refspecs.
  const refspecs = positionals.slice(1);
  const defaultRefspecs = refspecs.filter((refspec) =>
    isDefaultBranchRefspec(refspec)
  );
  if (defaultRefspecs.length === 0) {
    return false;
  }

  const plusForce = defaultRefspecs.some((refspec) => refspec.startsWith("+"));
  return forceFlag || plusForce;
}

function argsAfterGitSubcommand(argv: string[]): string[] {
  const valueOptions = new Set([
    "-C",
    "-c",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--exec-path",
    "--config-env"
  ]);

  let index = 1;
  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined) {
      break;
    }
    if (!token.startsWith("-")) {
      // This is the subcommand (`push`); its args follow.
      return argv.slice(index + 1);
    }
    if (valueOptions.has(token) && !token.includes("=")) {
      index += 2;
      continue;
    }
    index += 1;
  }

  return [];
}

function isDefaultBranchRefspec(refspec: string): boolean {
  const withoutForce = refspec.startsWith("+") ? refspec.slice(1) : refspec;
  const destination = withoutForce.includes(":")
    ? (withoutForce.split(":").pop() ?? "")
    : withoutForce;
  return /^(?:refs\/heads\/)?(?:main|master)$/.test(destination);
}

function firstPositional(args: string[]): string | undefined {
  return args.find((token) => !token.startsWith("-"));
}

function firstKnownVercelSub(args: string[]): string | undefined {
  return args.find(
    (token) => !token.startsWith("-") && knownVercelSubcommands.has(token)
  );
}

function positionalAfter(args: string[], keyword: string): string | undefined {
  const positionals = args.filter((token) => !token.startsWith("-"));
  const index = positionals.indexOf(keyword);
  return index >= 0 ? positionals[index + 1] : undefined;
}

function isMutationVerb(value: string | undefined, verbs: string[]): boolean {
  return value !== undefined && verbs.includes(value);
}

function baseName(token: string): string {
  const withoutTrailingSlash = token.replace(/\/+$/, "");
  const parts = withoutTrailingSlash.split("/");
  return (parts[parts.length - 1] ?? "").toLowerCase();
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
