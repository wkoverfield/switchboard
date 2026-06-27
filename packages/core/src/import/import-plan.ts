import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { loadSwitchboardConfig } from "../config/load-config.js";
import { resolveProjectClientConfigPath } from "../install/client-config.js";
import type { SupportedClient } from "../install/client-config.js";
import type { ScanProviderId } from "../scan/scan.js";

export const importPlanSchemaVersion = "switchboard.import-plan.v1";

export type ImportPlanActionKind =
  | "create-profile"
  | "store-secret"
  | "install-client"
  | "review-existing-profile";

export interface SwitchboardImportPlanOptions {
  cwd?: string;
}

export interface SwitchboardImportPlan {
  ok: true;
  schemaVersion: typeof importPlanSchemaVersion;
  mode: "dry-run";
  repo: {
    cwd: string;
    name: string;
  };
  detected: {
    clients: ImportClientDetection[];
    switchboardProfiles: ImportSwitchboardProfile[];
    envFiles: ImportEnvFileDetection[];
  };
  actions: ImportPlanAction[];
  commands: {
    dryRun: CommandShape;
    writePreview: CommandShape;
    installClients: CommandShape[];
    secretCommands: CommandShape[];
  };
  warnings: string[];
  safetyNotes: string[];
  nextActions: string[];
}

export interface CommandShape {
  command: string;
  args: string[];
}

export interface ImportClientDetection {
  client: SupportedClient;
  targetPath: string;
  status: "missing" | "detected" | "invalid";
  message: string;
  servers: ImportDetectedServer[];
}

export interface ImportDetectedServer {
  name: string;
  routesThroughSwitchboard: boolean;
  command: string | null;
  args: string[];
  envKeys: string[];
  provider: ScanProviderId | "unknown";
  suggestedProfileName: string;
  suggestedNamespace: string;
  suggestedSecretRefs: Array<{
    envName: string;
    ref: string;
  }>;
}

export interface ImportSwitchboardProfile {
  name: string;
  provider: string | null;
  namespace: string | null;
}

export interface ImportEnvFileDetection {
  path: string;
  envKeys: string[];
  providerHints: Array<ScanProviderId | "unknown">;
}

export interface ImportPlanAction {
  kind: ImportPlanActionKind;
  title: string;
  status: "planned" | "already-configured";
  client?: SupportedClient;
  serverName?: string;
  profileName?: string;
  provider?: ScanProviderId | "unknown";
  command?: CommandShape;
  reason: string;
}

const providerEnvPrefixes: Record<ScanProviderId, RegExp[]> = {
  github: [/^GITHUB_/i, /^GH_TOKEN$/i, /^GH_/i],
  vercel: [/^VERCEL_/i],
  stripe: [/^STRIPE_/i],
  supabase: [/^SUPABASE_/i],
  posthog: [/^POSTHOG_/i, /^NEXT_PUBLIC_POSTHOG_/i]
};

export async function createSwitchboardImportPlan(
  options: SwitchboardImportPlanOptions = {}
): Promise<SwitchboardImportPlan> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const repoName = basename(cwd);
  const loaded = loadSwitchboardConfig({ cwd });
  const profileNames = new Set(Object.keys(loaded.config.profiles));
  const switchboardProfiles = Object.entries(loaded.config.profiles).map(
    ([name, profile]) => ({
      name,
      provider: profile.provider ?? null,
      namespace: profile.namespace ?? null
    })
  );
  const clients = detectClientConfigs(cwd, repoName);
  const envFiles = detectEnvFiles(cwd);
  const detectedServers = clients.flatMap((client) =>
    client.servers.filter((server) => server.name !== "switchboard")
  );
  const createProfileActions = uniqueServersByProfile(detectedServers)
    .filter((server) => !profileNames.has(server.suggestedProfileName))
    .map((server) => createProfileAction(server));
  const secretActions = uniqueSecretRefs(detectedServers).map((secret) => ({
    kind: "store-secret" as const,
    title: `Store ${secret.envName} as ${secret.ref}`,
    status: "planned" as const,
    provider: providerFromEnvName(secret.envName),
    command: {
      command: "switchboard" as const,
      args: ["secrets", "set", secret.ref, "--value-stdin"]
    },
    reason:
      "The existing MCP config references this secret-looking env name; Switchboard will keep values out of repo and client config."
  }));
  const clientsMissingSwitchboard = clients.filter(
    (client) =>
      client.status !== "detected" ||
      !client.servers.some((server) => server.routesThroughSwitchboard)
  );
  const installActions = clientsMissingSwitchboard
    .map((client) => ({
      kind: "install-client" as const,
      title: `Route ${client.client} through Switchboard MCP`,
      status: "planned" as const,
      client: client.client,
      command: {
        command: "switchboard" as const,
        args: ["install", client.client, "--write"]
      },
      reason:
        "Importing profiles is separate from client installation so existing client config stays reversible."
    }));
  const reviewActions = switchboardProfiles.map((profile) => ({
    kind: "review-existing-profile" as const,
    title: `Review existing Switchboard profile ${profile.name}`,
    status: "already-configured" as const,
    profileName: profile.name,
    provider: providerFromProfile(profile.provider),
    reason:
      "Existing Switchboard profiles are preserved; import dry-run only plans around them."
  }));
  const secretCommands: CommandShape[] = secretActions.map(
    (action) => action.command
  );
  const installClients = clientsMissingSwitchboard.map((client) => ({
    command: "switchboard" as const,
    args: ["install", client.client, "--write"]
  }));
  const actions = [
    ...createProfileActions,
    ...secretActions,
    ...installActions,
    ...reviewActions
  ];
  const warnings = buildWarnings({ clients, envFiles, detectedServers });
  const safetyNotes = [
    "Dry run only: this command does not write .switchboard.yaml or client config.",
    "Secret values are never read from env files or client config; only env variable names are reported.",
    "Imported MCP servers should be treated as setup candidates until doctor and preset checks pass.",
    "Run client install separately so existing Codex/Claude config remains backup-protected and reversible."
  ];
  const nextActions = [
    "switchboard import --dry-run",
    ...secretCommands.map((command) => renderCommand(command)),
    ...installClients.map((command) => renderCommand(command))
  ];

  return {
    ok: true,
    schemaVersion: importPlanSchemaVersion,
    mode: "dry-run",
    repo: { cwd, name: repoName },
    detected: {
      clients,
      switchboardProfiles,
      envFiles
    },
    actions,
    commands: {
      dryRun: { command: "switchboard", args: ["import", "--dry-run"] },
      writePreview: { command: "switchboard", args: ["import", "--write"] },
      installClients,
      secretCommands
    },
    warnings,
    safetyNotes,
    nextActions: [...new Set(nextActions)]
  };
}

function uniqueServersByProfile(
  servers: ImportDetectedServer[]
): ImportDetectedServer[] {
  const byProfile = new Map<string, ImportDetectedServer>();
  for (const server of servers) {
    byProfile.set(server.suggestedProfileName, server);
  }
  return [...byProfile.values()];
}

function detectClientConfigs(
  cwd: string,
  repoName: string
): ImportClientDetection[] {
  return [
    detectCodexConfig(resolveProjectClientConfigPath("codex", cwd), repoName),
    detectClaudeConfig(resolveProjectClientConfigPath("claude", cwd), repoName)
  ];
}

function detectCodexConfig(
  targetPath: string,
  repoName: string
): ImportClientDetection {
  const content = readOptionalTextFile(targetPath);
  if (content === null) {
    return missingClient("codex", targetPath);
  }

  try {
    return {
      client: "codex",
      targetPath,
      status: "detected",
      message: "Codex project MCP config was found.",
      servers: codexServerSections(content).map((section) =>
        detectedServerFromEntry({
          repoName,
          name: section.name,
          command: parseTomlString(section.assignments.command),
          args: parseTomlStringArray(section.assignments.args),
          envKeys: [
            ...parseTomlInlineObjectKeys(section.assignments.env),
            ...section.envKeys
          ]
        })
      )
    };
  } catch (error) {
    return invalidClient("codex", targetPath, error);
  }
}

function detectClaudeConfig(
  targetPath: string,
  repoName: string
): ImportClientDetection {
  const content = readOptionalTextFile(targetPath);
  if (content === null) {
    return missingClient("claude", targetPath);
  }

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const mcpServers = isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
    return {
      client: "claude",
      targetPath,
      status: "detected",
      message: "Claude project MCP config was found.",
      servers: Object.entries(mcpServers).map(([name, value]) =>
        detectedServerFromEntry({
          repoName,
          name,
          command:
            isRecord(value) && typeof value.command === "string"
              ? value.command
              : null,
          args:
            isRecord(value) && Array.isArray(value.args)
              ? value.args.filter((arg): arg is string => typeof arg === "string")
              : [],
          envKeys:
            isRecord(value) && isRecord(value.env)
              ? Object.keys(value.env).sort()
              : []
        })
      )
    };
  } catch (error) {
    return invalidClient("claude", targetPath, error);
  }
}

function missingClient(
  client: SupportedClient,
  targetPath: string
): ImportClientDetection {
  return {
    client,
    targetPath,
    status: "missing",
    message: `${client} project MCP config was not found.`,
    servers: []
  };
}

function invalidClient(
  client: SupportedClient,
  targetPath: string,
  error: unknown
): ImportClientDetection {
  return {
    client,
    targetPath,
    status: "invalid",
    message: messageFromError(error),
    servers: []
  };
}

function detectedServerFromEntry(options: {
  repoName: string;
  name: string;
  command: string | null;
  args: string[];
  envKeys: string[];
}): ImportDetectedServer {
  const routesThroughSwitchboard = options.name === "switchboard";
  const provider = routesThroughSwitchboard
    ? "unknown"
    : inferProvider({
        name: options.name,
        command: options.command,
        args: options.args,
        envKeys: options.envKeys
      });
  const environment = inferEnvironment(options);
  const profileBase =
    provider === "unknown" ? options.name : `${provider}_${options.repoName}`;
  const suggestedProfileName = safeIdentifier(
    environment === "unknown" ? profileBase : `${profileBase}_${environment}`
  );

  return {
    name: options.name,
    routesThroughSwitchboard,
    command: options.command,
    args: options.args,
    envKeys: [...new Set(options.envKeys)].sort(),
    provider,
    suggestedProfileName,
    suggestedNamespace: suggestedProfileName,
    suggestedSecretRefs: options.envKeys
      .filter(isSecretLikeName)
      .map((envName) => ({
        envName,
        ref: `${provider === "unknown" ? "mcp" : provider}/${safeIdentifier(options.repoName)}/${environment === "unknown" ? "dev" : environment}/${secretRefLeaf(envName)}`
      }))
  };
}

function createProfileAction(server: ImportDetectedServer): ImportPlanAction {
  return {
    kind: "create-profile",
    title: `Create Switchboard profile ${server.suggestedProfileName}`,
    status: "planned",
    serverName: server.name,
    profileName: server.suggestedProfileName,
    provider: server.provider,
    reason:
      "An existing MCP server was found in project client config and can be routed through Switchboard."
  };
}

function uniqueSecretRefs(
  servers: ImportDetectedServer[]
): Array<{ envName: string; ref: string }> {
  const byRef = new Map<string, { envName: string; ref: string }>();
  for (const server of servers) {
    for (const secret of server.suggestedSecretRefs) {
      byRef.set(secret.ref, secret);
    }
  }
  return [...byRef.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

function detectEnvFiles(cwd: string): ImportEnvFileDetection[] {
  let entries: string[];
  try {
    entries = readdirSync(cwd);
  } catch {
    return [];
  }

  return entries
    .filter((entry) => /^\.env(?:\.|$)/.test(entry))
    .map((entry) => join(cwd, entry))
    .filter((path) => safeIsFile(path))
    .map((path) => {
      const envKeys = envVarNames(readFileSync(path, "utf8"));
      return {
        path,
        envKeys,
        providerHints: [...new Set(envKeys.map(providerFromEnvName))]
      };
    });
}

function buildWarnings(options: {
  clients: ImportClientDetection[];
  envFiles: ImportEnvFileDetection[];
  detectedServers: ImportDetectedServer[];
}): string[] {
  const warnings: string[] = [];
  for (const client of options.clients) {
    if (client.status === "invalid") {
      warnings.push(`${client.client} config could not be parsed: ${client.message}`);
    }
    if (client.servers.some((server) => server.name === "switchboard")) {
      warnings.push(
        `${client.client} already has a switchboard MCP server; import will preserve it.`
      );
    }
  }
  if (options.detectedServers.length === 0) {
    warnings.push("No existing project MCP servers were found to import.");
  }
  if (
    options.envFiles.some((file) => file.envKeys.some((key) => isSecretLikeName(key)))
  ) {
    warnings.push(
      "Secret-looking env var names were found in env files; import reports names only and does not read values."
    );
  }
  if (
    options.detectedServers.some((server) =>
      server.envKeys.some((key) => isSecretLikeName(key))
    )
  ) {
    warnings.push(
      "Existing MCP configs reference secret-looking env names; store values behind Switchboard local token aliases before routing agents."
    );
  }

  return [...new Set(warnings)];
}

function codexServerSections(content: string): Array<{
  name: string;
  assignments: Record<string, string>;
  envKeys: string[];
}> {
  const sections: Array<{
    name: string;
    assignments: Record<string, string>;
    envKeys: string[];
  }> = [];
  let current:
    | {
        name: string;
        assignments: Record<string, string>;
        envKeys: string[];
        envSection: boolean;
      }
    | null = null;

  for (const line of content.split(/\r?\n/)) {
    const serverHeader = line.match(/^\s*\[mcp_servers\.([^\].]+)\]\s*$/);
    const envHeader = line.match(/^\s*\[mcp_servers\.([^\].]+)\.env\]\s*$/);
    if (serverHeader?.[1]) {
      if (current) {
        sections.push(current);
      }
      current = {
        name: unquoteTomlKey(serverHeader[1]),
        assignments: {},
        envKeys: [],
        envSection: false
      };
      continue;
    }
    if (envHeader?.[1]) {
      if (current) {
        sections.push(current);
      }
      current = {
        name: unquoteTomlKey(envHeader[1]),
        assignments: {},
        envKeys: [],
        envSection: true
      };
      continue;
    }
    if (!current) {
      continue;
    }
    const assignment = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.*?)\s*$/);
    if (!assignment?.[1] || assignment[2] === undefined) {
      continue;
    }
    if (current.envSection) {
      current.envKeys.push(assignment[1]);
    } else {
      current.assignments[assignment[1]] = assignment[2];
    }
  }
  if (current) {
    sections.push(current);
  }

  const merged = new Map<
    string,
    { name: string; assignments: Record<string, string>; envKeys: string[] }
  >();
  for (const section of sections) {
    const existing = merged.get(section.name);
    if (existing) {
      Object.assign(existing.assignments, section.assignments);
      existing.envKeys.push(...section.envKeys);
    } else {
      merged.set(section.name, {
        name: section.name,
        assignments: { ...section.assignments },
        envKeys: [...section.envKeys]
      });
    }
  }
  return [...merged.values()];
}

function parseTomlString(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(/^"((?:\\"|[^"])*)"$/);
  return match?.[1]?.replace(/\\"/g, "\"") ?? null;
}

function parseTomlStringArray(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }
  const matches = [...trimmed.matchAll(/"((?:\\"|[^"])*)"/g)];
  return matches.map((match) => (match[1] ?? "").replace(/\\"/g, "\""));
}

function parseTomlInlineObjectKeys(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return [];
  }
  return [...trimmed.matchAll(/([A-Za-z_][A-Za-z0-9_-]*)\s*=/g)]
    .map((match) => match[1])
    .filter((key): key is string => key !== undefined)
    .sort();
}

function unquoteTomlKey(value: string): string {
  return value.replace(/^"|"$/g, "");
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

function inferProvider(options: {
  name: string;
  command: string | null;
  args: string[];
  envKeys: string[];
}): ScanProviderId | "unknown" {
  const haystack = [options.name, options.command ?? "", ...options.args, ...options.envKeys]
    .join(" ")
    .toLowerCase();
  for (const provider of Object.keys(providerEnvPrefixes) as ScanProviderId[]) {
    if (haystack.includes(provider)) {
      return provider;
    }
  }
  if (options.envKeys.some((key) => providerFromEnvName(key) !== "unknown")) {
    return providerFromEnvName(
      options.envKeys.find((key) => providerFromEnvName(key) !== "unknown") ?? ""
    );
  }
  return "unknown";
}

function providerFromEnvName(name: string): ScanProviderId | "unknown" {
  for (const [provider, patterns] of Object.entries(providerEnvPrefixes) as Array<
    [ScanProviderId, RegExp[]]
  >) {
    if (patterns.some((pattern) => pattern.test(name))) {
      return provider;
    }
  }
  return "unknown";
}

function providerFromProfile(value: string | null): ScanProviderId | "unknown" {
  if (
    value === "github" ||
    value === "vercel" ||
    value === "stripe" ||
    value === "supabase" ||
    value === "posthog"
  ) {
    return value;
  }
  return "unknown";
}

function inferEnvironment(options: {
  name: string;
  args: string[];
  envKeys: string[];
}): "dev" | "test" | "preview" | "prod" | "unknown" {
  const text = [options.name, ...options.args, ...options.envKeys].join(" ");
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

function safeIdentifier(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "mcp_server";
}

function secretRefLeaf(envName: string): string {
  if (/TOKEN/i.test(envName)) {
    return "token";
  }
  if (/KEY/i.test(envName)) {
    return "key";
  }
  if (/SECRET/i.test(envName)) {
    return "secret";
  }
  return safeIdentifier(envName);
}

function isSecretLikeName(name: string): boolean {
  return /(SECRET|TOKEN|KEY|PASSWORD|PRIVATE)/i.test(name);
}

function renderCommand(command: CommandShape): string {
  return ["switchboard", ...command.args].join(" ");
}

function readOptionalTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function safeIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
