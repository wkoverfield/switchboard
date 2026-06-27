import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { loadSwitchboardConfig } from "../config/load-config.js";
import {
  createSwitchboardImportPlan,
  type BypassFinding,
  type RiskFinding
} from "../import/import-plan.js";
import { inspectProjectClientConfigs } from "../install/client-config.js";
import type { ProjectClientConfigInspection } from "../install/client-config.js";
import {
  planRecommendedNextAction,
  type NextActionCandidate,
  type RecommendedNextAction
} from "../next-actions/next-actions.js";

export const scanSchemaVersion = "switchboard.scan.v1";

export type ScanProviderId =
  | "github"
  | "vercel"
  | "stripe"
  | "supabase"
  | "posthog";

export type ScanEnvironmentClass =
  | "dev"
  | "test"
  | "preview"
  | "prod"
  | "unknown";

export interface SwitchboardScanOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  command?: string;
  commandArgs?: string[];
}

export interface SwitchboardScanResult {
  schemaVersion: typeof scanSchemaVersion;
  repo: {
    cwd: string;
    gitRoot: string | null;
    name: string;
    branch: string | null;
    remote: {
      url: string | null;
      owner: string | null;
      repo: string | null;
      provider: "github" | "unknown" | null;
    };
  };
  runtime: {
    kind: "local" | "git-worktree";
    devcontainerPresent: boolean;
    vercelProjectPresent: boolean;
  };
  clients: Array<
    Pick<
      ProjectClientConfigInspection,
      "client" | "targetPath" | "status" | "message" | "otherServerNames"
    >
  >;
  providers: ScanProviderHint[];
  switchboard: {
    configSources: Array<{
      kind: string;
      path?: string;
      loaded: boolean;
    }>;
    profileNames: string[];
    workspaceNames: string[];
  };
  riskFindings: RiskFinding[];
  bypassFindings: BypassFinding[];
  suggestions: ScanSuggestion[];
  warnings: string[];
  recommendedNextAction: RecommendedNextAction;
  nextActions: string[];
}

export interface ScanProviderHint {
  provider: ScanProviderId;
  sources: ScanProviderSource[];
  envVars: string[];
  environment: ScanEnvironmentClass;
  switchboardProfiles: string[];
}

export interface ScanProviderSource {
  kind: "env-file" | "directory" | "file" | "client-config";
  path: string;
  detail?: string;
}

export interface ScanSuggestion {
  kind: "provider-profile" | "client-install" | "mandate";
  provider?: ScanProviderId;
  profileName?: string;
  namespace?: string;
  command: string;
  reason: string;
}

const providerEnvPrefixes: Record<ScanProviderId, RegExp[]> = {
  github: [/^GITHUB_/i, /^GH_TOKEN$/i, /^GH_/i],
  vercel: [/^VERCEL_/i],
  stripe: [/^STRIPE_/i],
  supabase: [/^SUPABASE_/i],
  posthog: [/^POSTHOG_/i, /^NEXT_PUBLIC_POSTHOG_/i]
};

const providerFileHints: Array<{
  provider: ScanProviderId;
  path: string;
  kind: ScanProviderSource["kind"];
  detail?: string;
}> = [
  {
    provider: "vercel",
    path: ".vercel/project.json",
    kind: "file",
    detail: "Vercel project link present"
  },
  {
    provider: "supabase",
    path: "supabase/config.toml",
    kind: "file",
    detail: "Supabase local config present"
  },
  {
    provider: "posthog",
    path: "posthog.json",
    kind: "file",
    detail: "PostHog config present"
  }
];

export async function scanSwitchboardProject(
  options: SwitchboardScanOptions = {}
): Promise<SwitchboardScanResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const gitRoot = gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
  const root = gitRoot ?? cwd;
  const branch = gitOutput(root, ["branch", "--show-current"]);
  const remoteUrl = gitOutput(root, ["config", "--get", "remote.origin.url"]);
  const remote = parseGitRemote(remoteUrl);
  const loaded = loadSwitchboardConfig({
    cwd: root,
    ...(options.env ? { env: options.env } : {}),
    ...(options.homeDir ? { homeDir: options.homeDir } : {})
  });
  const profileNames = Object.keys(loaded.config.profiles);
  const workspaceNames = Object.keys(loaded.config.workspaces ?? {});
  const clients = await inspectProjectClientConfigs({
    cwd: root,
    ...(options.command ? { command: options.command } : {}),
    ...(options.commandArgs ? { commandArgs: options.commandArgs } : {})
  });
  const importPlan = await createSwitchboardImportPlan({
    cwd: root,
    ...(options.env ? { env: options.env } : {}),
    ...(options.homeDir ? { homeDir: options.homeDir } : {})
  });
  const bypassFindings = importPlan.bypassFindings;
  const riskFindings = importPlan.riskFindings;
  const envFiles = scanEnvFiles(root);
  const providers = collectProviderHints({
    root,
    envFiles,
    profileNames,
    remoteProvider: remote.provider
  });
  const runtime = {
    kind: isGitWorktree(root) ? "git-worktree" : "local",
    devcontainerPresent: existsSync(join(root, ".devcontainer", "devcontainer.json")),
    vercelProjectPresent: existsSync(join(root, ".vercel", "project.json"))
  } as const;
  const warnings = buildWarnings({
    providers,
    profileNames,
    clients,
    riskFindings,
    bypassFindings
  });
  const suggestions = buildSuggestions({
    providers,
    profileNames,
    clients,
    repoName: basename(root)
  });
  const nextActions = [
    ...(bypassFindings.length > 0 ? ["switchboard import --dry-run"] : []),
    ...nextActionsFromSuggestions(suggestions)
  ];
  const recommendedNextAction = planRecommendedNextAction(
    scanNextActionCandidates({
      diagnostics: loaded.diagnostics,
      bypassFindings,
      suggestions,
      nextActions
    })
  );

  return {
    schemaVersion: scanSchemaVersion,
    repo: {
      cwd,
      gitRoot,
      name: basename(root),
      branch: branch && branch.length > 0 ? branch : null,
      remote
    },
    runtime,
    clients: clients.map((client) => ({
      client: client.client,
      targetPath: client.targetPath,
      status: client.status,
      message: client.message,
      otherServerNames: client.otherServerNames
    })),
    providers,
    switchboard: {
      configSources: loaded.sources.map((source) => ({
        kind: source.kind,
        ...(source.path ? { path: source.path } : {}),
        loaded: source.loaded
      })),
      profileNames,
      workspaceNames
    },
    riskFindings,
    bypassFindings,
    suggestions,
    warnings,
    recommendedNextAction,
    nextActions
  };
}

function scanNextActionCandidates(options: {
  diagnostics: Array<{ level: string }>;
  bypassFindings: BypassFinding[];
  suggestions: ScanSuggestion[];
  nextActions: string[];
}): NextActionCandidate[] {
  const candidates: NextActionCandidate[] = [];
  if (options.diagnostics.some((diagnostic) => diagnostic.level === "error")) {
    candidates.push({
      kind: "invalid-config",
      command: "switchboard doctor",
      reason: "Switchboard config has diagnostics that should be fixed first."
    });
  }
  if (options.bypassFindings.length > 0) {
    candidates.push({
      kind: "bypass-cleanup",
      command: "switchboard import --dry-run",
      reason: "Direct MCP routes can bypass Switchboard authority."
    });
  }
  for (const suggestion of options.suggestions) {
    candidates.push({
      kind:
        suggestion.kind === "client-install"
          ? "client-install"
          : suggestion.kind === "mandate"
            ? "mandate-create"
            : "provider-setup",
      command: suggestion.command,
      reason: suggestion.reason
    });
  }
  for (const action of options.nextActions) {
    candidates.push({
      kind: "info",
      command: action,
      reason: "Additional setup command suggested by scan."
    });
  }
  return candidates;
}

function gitOutput(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function parseGitRemote(url: string | null): SwitchboardScanResult["repo"]["remote"] {
  if (!url) {
    return { url: null, owner: null, repo: null, provider: null };
  }

  const safeUrl = sanitizeGitRemoteUrl(url);
  const githubHttps = url.match(
    /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i
  );
  const safeGithubHttps = safeUrl.match(
    /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i
  );
  const githubSsh = safeUrl.match(
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i
  );
  const match = githubHttps ?? safeGithubHttps ?? githubSsh;

  if (!match) {
    return { url: safeUrl, owner: null, repo: null, provider: "unknown" };
  }

  return {
    url: safeUrl,
    owner: match[1] ?? null,
    repo: match[2] ?? null,
    provider: "github"
  };
}

function sanitizeGitRemoteUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url
      .replace(/^(https?:\/\/)[^/@\s]+@/i, "$1")
      .replace(/[?#].*$/, "");
  }
}

function isGitWorktree(root: string): boolean {
  try {
    return lstatSync(join(root, ".git")).isFile();
  } catch {
    return false;
  }
}

interface EnvFileScan {
  path: string;
  names: string[];
  environment: ScanEnvironmentClass;
}

function scanEnvFiles(root: string): EnvFileScan[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }

  return entries
    .filter((entry) => /^\.env(?:\.|$)/.test(entry))
    .map((entry) => join(root, entry))
    .filter((path) => safeIsFile(path))
    .map((path) => ({
      path,
      names: envVarNames(readFileSync(path, "utf8")),
      environment: environmentFromText(basename(path))
    }));
}

function safeIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function envVarNames(content: string): string[] {
  const names = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match?.[1]) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

function collectProviderHints(options: {
  root: string;
  envFiles: EnvFileScan[];
  profileNames: string[];
  remoteProvider: "github" | "unknown" | null;
}): ScanProviderHint[] {
  const hints = new Map<ScanProviderId, ScanProviderHint>();

  if (options.remoteProvider === "github") {
    addProviderSource(hints, "github", {
      kind: "file",
      path: join(options.root, ".git"),
      detail: "GitHub remote detected"
    });
  }

  for (const envFile of options.envFiles) {
    for (const [provider, patterns] of Object.entries(providerEnvPrefixes) as Array<
      [ScanProviderId, RegExp[]]
    >) {
      const names = envFile.names.filter((name) =>
        patterns.some((pattern) => pattern.test(name))
      );
      if (names.length === 0) {
        continue;
      }

      const hint = ensureProviderHint(hints, provider);
      hint.sources.push({
        kind: "env-file",
        path: envFile.path,
        detail: `${names.length} matching env var name(s)`
      });
      hint.envVars.push(...names);
      hint.environment = combineEnvironment(
        hint.environment,
        environmentFromNames(names, envFile.environment)
      );
    }
  }

  for (const fileHint of providerFileHints) {
    const path = join(options.root, fileHint.path);
    if (existsSync(path)) {
      addProviderSource(hints, fileHint.provider, {
        kind: fileHint.kind,
        path,
        ...(fileHint.detail ? { detail: fileHint.detail } : {})
      });
    }
  }

  for (const hint of hints.values()) {
    hint.envVars = [...new Set(hint.envVars)].sort();
    hint.switchboardProfiles = options.profileNames.filter((profile) =>
      profile.toLowerCase().includes(hint.provider)
    );
  }

  return [...hints.values()].sort((a, b) =>
    a.provider.localeCompare(b.provider)
  );
}

function ensureProviderHint(
  hints: Map<ScanProviderId, ScanProviderHint>,
  provider: ScanProviderId
): ScanProviderHint {
  const existing = hints.get(provider);
  if (existing) {
    return existing;
  }

  const next: ScanProviderHint = {
    provider,
    sources: [],
    envVars: [],
    environment: "unknown",
    switchboardProfiles: []
  };
  hints.set(provider, next);
  return next;
}

function addProviderSource(
  hints: Map<ScanProviderId, ScanProviderHint>,
  provider: ScanProviderId,
  source: ScanProviderSource
): void {
  ensureProviderHint(hints, provider).sources.push(source);
}

function environmentFromNames(
  names: string[],
  fallback: ScanEnvironmentClass
): ScanEnvironmentClass {
  const joined = names.join(" ");
  const fromNames = environmentFromText(joined);
  return fromNames === "unknown" ? fallback : fromNames;
}

function environmentFromText(text: string): ScanEnvironmentClass {
  if (/(^|[_\-.])(prod|production|live)([_\-.]|$)/i.test(text)) {
    return "prod";
  }
  if (/(^|[_\-.])preview([_\-.]|$)/i.test(text)) {
    return "preview";
  }
  if (/(^|[_\-.])(test|testing)([_\-.]|$)/i.test(text)) {
    return "test";
  }
  if (/(^|[_\-.])(dev|development|local)([_\-.]|$)/i.test(text)) {
    return "dev";
  }
  return "unknown";
}

function combineEnvironment(
  current: ScanEnvironmentClass,
  next: ScanEnvironmentClass
): ScanEnvironmentClass {
  if (current === "prod" || next === "prod") {
    return "prod";
  }
  if (current === "preview" || next === "preview") {
    return "preview";
  }
  if (current === "test" || next === "test") {
    return "test";
  }
  if (current === "dev" || next === "dev") {
    return "dev";
  }
  return "unknown";
}

function buildWarnings(options: {
  providers: ScanProviderHint[];
  profileNames: string[];
  clients: ProjectClientConfigInspection[];
  riskFindings: RiskFinding[];
  bypassFindings: BypassFinding[];
}): string[] {
  const warnings: string[] = [];
  const installedClients = options.clients.filter(
    (client) => client.status === "installed"
  );

  for (const provider of options.providers) {
    if (provider.envVars.some(isSecretLikeName)) {
      warnings.push(
        `${provider.provider} secret-looking env var names detected; scan did not read or print values.`
      );
    }
    if (provider.environment === "prod") {
      warnings.push(
        `${provider.provider} looks production/live-related; prefer non-prod profiles or approval-gated mandates.`
      );
    }
    if (provider.switchboardProfiles.length === 0) {
      warnings.push(
        `${provider.provider} hints found but no matching Switchboard profile is configured.`
      );
    }
  }

  if (options.providers.length > 0 && installedClients.length === 0) {
    warnings.push(
      "Provider hints found, but no project agent client currently routes through switchboard mcp."
    );
  }

  if (options.profileNames.length > 0 && installedClients.length === 0) {
    warnings.push(
      "Switchboard profiles are configured, but Codex/Claude project config is not installed yet."
    );
  }

  if (options.bypassFindings.length > 0) {
    const highOrCritical = options.bypassFindings.filter(
      (finding) => finding.severity === "high" || finding.severity === "critical"
    ).length;
    warnings.push(
      highOrCritical > 0
        ? `${options.bypassFindings.length} direct MCP bypass finding(s), including ${highOrCritical} high-risk finding(s), were detected.`
        : `${options.bypassFindings.length} direct MCP bypass finding(s) were detected.`
    );
  }
  const highOrCriticalRisks = options.riskFindings.filter(
    (finding) => finding.severity === "high" || finding.severity === "critical"
  );
  if (highOrCriticalRisks.length > 0) {
    warnings.push(
      `${highOrCriticalRisks.length} high-risk provider/environment hint(s) were detected.`
    );
  }

  return [...new Set(warnings)];
}

function isSecretLikeName(name: string): boolean {
  return /(SECRET|TOKEN|KEY|PASSWORD|PRIVATE)/i.test(name);
}

function buildSuggestions(options: {
  providers: ScanProviderHint[];
  profileNames: string[];
  clients: ProjectClientConfigInspection[];
  repoName: string;
}): ScanSuggestion[] {
  const suggestions: ScanSuggestion[] = [];
  const providers = new Set(options.providers.map((provider) => provider.provider));

  if (providers.has("github") && !hasProfile(options.profileNames, "github")) {
    suggestions.push({
      kind: "provider-profile",
      provider: "github",
      profileName: repoAwareProfileName("github-ci", options.repoName),
      namespace: repoAwareProfileName("github-ci", options.repoName),
      command: "switchboard setup github-ci",
      reason: "GitHub repo or env hints were detected."
    });
  }

  if (providers.has("vercel") && !hasProfile(options.profileNames, "vercel")) {
    suggestions.push({
      kind: "provider-profile",
      provider: "vercel",
      profileName: repoAwareProfileName("vercel-preview", options.repoName),
      namespace: repoAwareProfileName("vercel-preview", options.repoName),
      command: "switchboard setup vercel-preview",
      reason: "Vercel project or env hints were detected."
    });
  }

  for (const client of options.clients) {
    if (client.status !== "installed") {
      suggestions.push({
        kind: "client-install",
        command: `switchboard install ${client.client} --write`,
        reason: `${client.client} project config is ${client.status}.`
      });
    }
  }

  for (const presetId of configuredMandatePresetIds(options.profileNames)) {
    suggestions.push({
      kind: "mandate",
      command: `switchboard mandate create --from ${presetId}`,
      reason: "Use a leased mandate before letting an agent call provider tools."
    });
  }

  return suggestions;
}

function repoAwareProfileName(presetId: string, repoName: string): string {
  const repo = safeIdentifier(repoName);
  if (presetId === "github-ci") {
    return `github_${repo}_ci`;
  }
  if (presetId === "vercel-preview") {
    return `vercel_${repo}_preview`;
  }
  return safeIdentifier(`${presetId}_${repo}`);
}

function configuredMandatePresetIds(profileNames: string[]): string[] {
  const presetIds: string[] = [];
  if (hasProfile(profileNames, "github")) {
    presetIds.push("github-ci");
  }
  if (hasProfile(profileNames, "vercel")) {
    presetIds.push("vercel-preview");
  }
  if (hasProfile(profileNames, "stripe")) {
    presetIds.push("stripe-test");
  }
  return presetIds;
}

function hasProfile(profileNames: string[], provider: ScanProviderId): boolean {
  return profileNames.some((profile) => profile.toLowerCase().includes(provider));
}

function nextActionsFromSuggestions(suggestions: ScanSuggestion[]): string[] {
  return [...new Set(suggestions.map((suggestion) => suggestion.command))];
}

function safeIdentifier(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "repo";
}
