import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";

export type SupportedClient = "codex" | "claude";

export type ClientConfigScope = "project" | "user";

export interface SwitchboardClientConfigOptions {
  client: SupportedClient;
  serverName?: string;
  command?: string;
  commandArgs?: string[];
  cwd: string;
  scope?: ClientConfigScope;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RenderedClientConfig {
  client: SupportedClient;
  serverName: string;
  target: string;
  content: string;
}

export interface WrittenClientConfig {
  client: SupportedClient;
  scope: ClientConfigScope;
  serverName: string;
  targetPath: string;
  backupPath: string | null;
  action: "created" | "updated";
}

export interface RolledBackClientConfig {
  client: SupportedClient;
  scope: ClientConfigScope;
  targetPath: string;
  restoredFrom: string;
  backupPath: string | null;
}

export interface ClientConfigValidationResult {
  ok: boolean;
  errors: string[];
}

export type ProjectClientConfigStatus =
  | "missing"
  | "installed"
  | "stale"
  | "invalid";

export interface ProjectClientConfigInspection {
  client: SupportedClient;
  scope: ClientConfigScope;
  serverName: string;
  targetPath: string;
  status: ProjectClientConfigStatus;
  message: string;
  otherServerNames: string[];
  launch: {
    command: string;
    args: string[];
  } | null;
}

export interface ClientLaunchCheck {
  client: SupportedClient;
  serverName: string;
  command: string;
  args: string[];
  ok: boolean;
  message: string;
}

const defaultServerName = "switchboard";
const defaultCommand = "switchboard";

export function renderSwitchboardClientConfig(
  options: SwitchboardClientConfigOptions
): RenderedClientConfig {
  const serverName = options.serverName ?? defaultServerName;
  const command = options.command ?? defaultCommand;
  const commandArgs = options.commandArgs ?? [];
  const scope = options.scope ?? "project";
  // A user-scoped server entry launches with no --cwd: `switchboard mcp`
  // resolves the repo from the process working directory per request, so one
  // entry serves every repo.
  const args =
    scope === "user"
      ? [...commandArgs, "mcp"]
      : [...commandArgs, "--cwd", options.cwd, "mcp"];
  const validation = validateSwitchboardClientConfigOptions({
    ...options,
    serverName,
    command,
    commandArgs
  });

  if (!validation.ok) {
    throw new Error(validation.errors.join("\n"));
  }

  if (options.client === "codex") {
    return {
      client: "codex",
      serverName,
      target:
        scope === "user"
          ? "~/.codex/config.toml (or $CODEX_HOME/config.toml)"
          : "~/.codex/config.toml or .codex/config.toml",
      content: renderCodexConfig({
        serverName,
        command,
        args,
        ...(scope === "project" ? { cwd: options.cwd } : {})
      })
    };
  }

  return {
    client: "claude",
    serverName,
    target:
      scope === "user"
        ? "~/.claude.json (managed by claude mcp add --scope user)"
        : ".mcp.json for project scope or ~/.claude.json for local/user scope",
    content: JSON.stringify(
      {
        mcpServers: {
          [serverName]: {
            command,
            args,
            env: {}
          }
        }
      },
      null,
      2
    )
  };
}

export async function writeSwitchboardClientConfig(
  options: SwitchboardClientConfigOptions & { now?: Date }
): Promise<WrittenClientConfig> {
  const scope = options.scope ?? "project";
  const rendered = renderSwitchboardClientConfig(options);
  const targetPath = resolveClientConfigPath({
    client: options.client,
    scope,
    cwd: options.cwd,
    ...(options.homeDir ? { homeDir: options.homeDir } : {}),
    ...(options.env ? { env: options.env } : {})
  });
  const existing = await readOptionalTextFile(targetPath);
  const nextContent = mergeClientConfigContent({
    client: options.client,
    existing,
    renderedContent: rendered.content,
    serverName: rendered.serverName
  });

  await mkdir(dirname(targetPath), { recursive: true });
  const backupPath = existing
    ? await backupExistingFile(targetPath, options.now)
    : null;

  await writeFile(targetPath, nextContent, "utf8");

  return {
    client: options.client,
    scope,
    serverName: rendered.serverName,
    targetPath,
    backupPath,
    action: existing ? "updated" : "created"
  };
}

export async function rollbackSwitchboardClientConfig(options: {
  client: SupportedClient;
  cwd: string;
  backupPath: string;
  scope?: ClientConfigScope;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<RolledBackClientConfig> {
  const scope = options.scope ?? "project";
  const targetPath = resolveClientConfigPath({
    client: options.client,
    scope,
    cwd: options.cwd,
    ...(options.homeDir ? { homeDir: options.homeDir } : {}),
    ...(options.env ? { env: options.env } : {})
  });
  const backupContent = await readFile(options.backupPath, "utf8");
  const existing = await readOptionalTextFile(targetPath);

  await mkdir(dirname(targetPath), { recursive: true });
  const currentBackupPath = existing
    ? await backupExistingFile(targetPath, options.now)
    : null;
  await writeFile(targetPath, backupContent, "utf8");

  return {
    client: options.client,
    scope,
    targetPath,
    restoredFrom: options.backupPath,
    backupPath: currentBackupPath
  };
}

export function resolveClientConfigPath(options: {
  client: SupportedClient;
  scope?: ClientConfigScope;
  cwd: string;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const scope = options.scope ?? "project";

  if (scope === "project") {
    if (options.client === "codex") {
      return join(options.cwd, ".codex", "config.toml");
    }

    return join(options.cwd, ".mcp.json");
  }

  const home = options.homeDir ?? homedir();
  if (options.client === "codex") {
    const env = options.env ?? process.env;
    const codexHome = env.CODEX_HOME?.trim();
    return join(codexHome ? codexHome : join(home, ".codex"), "config.toml");
  }

  return join(home, ".claude.json");
}

export function resolveProjectClientConfigPath(
  client: SupportedClient,
  cwd: string
): string {
  return resolveClientConfigPath({ client, scope: "project", cwd });
}

export async function inspectProjectClientConfig(
  options: SwitchboardClientConfigOptions
): Promise<ProjectClientConfigInspection> {
  const scope = options.scope ?? "project";
  const rendered = renderSwitchboardClientConfig(options);
  const targetPath = resolveClientConfigPath({
    client: options.client,
    scope,
    cwd: options.cwd,
    ...(options.homeDir ? { homeDir: options.homeDir } : {}),
    ...(options.env ? { env: options.env } : {})
  });
  const existing = await readOptionalTextFile(targetPath);

  if (existing === null) {
    return {
      client: options.client,
      scope,
      serverName: rendered.serverName,
      targetPath,
      status: "missing",
      message:
        scope === "user"
          ? "User client config file was not found."
          : "Project client config file was not found.",
      otherServerNames: [],
      launch: null
    };
  }

  try {
    if (options.client === "claude") {
      return inspectClaudeClientConfig({
        existing,
        renderedContent: rendered.content,
        targetPath,
        serverName: rendered.serverName,
        scope
      });
    }

    return inspectCodexClientConfig({
      existing,
      targetPath,
      serverName: rendered.serverName,
      command: options.command ?? defaultCommand,
      commandArgs: options.commandArgs ?? [],
      cwd: options.cwd,
      scope
    });
  } catch (error) {
    return {
      client: options.client,
      scope,
      serverName: rendered.serverName,
      targetPath,
      status: "invalid",
      message: messageFromError(error),
      otherServerNames: [],
      launch: null
    };
  }
}

export async function inspectProjectClientConfigs(options: {
  cwd: string;
  serverName?: string;
  command?: string;
  commandArgs?: string[];
}): Promise<ProjectClientConfigInspection[]> {
  return Promise.all([
    inspectProjectClientConfig({ ...options, client: "codex" }),
    inspectProjectClientConfig({ ...options, client: "claude" })
  ]);
}

export function validateSwitchboardClientConfigOptions(
  options: SwitchboardClientConfigOptions
): ClientConfigValidationResult {
  const serverName = options.serverName ?? defaultServerName;
  const command = options.command ?? defaultCommand;
  const commandArgs = options.commandArgs ?? [];
  const errors: string[] = [];

  if (serverName.trim().length === 0) {
    errors.push("server name must not be empty");
  }

  if (containsControlCharacter(serverName)) {
    errors.push("server name must not contain control characters");
  }

  if (command.trim().length === 0) {
    errors.push("command must not be empty");
  }

  if (containsControlCharacter(command)) {
    errors.push("command must not contain control characters");
  }

  for (const [index, arg] of commandArgs.entries()) {
    if (containsControlCharacter(arg)) {
      errors.push(`command arg ${index + 1} must not contain control characters`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export async function checkInstalledClientLaunches(
  inspections: ProjectClientConfigInspection[],
  env: NodeJS.ProcessEnv = process.env
): Promise<ClientLaunchCheck[]> {
  return Promise.all(
    inspections
      .filter((inspection) => inspection.status === "installed")
      .map(async (inspection) => {
        const launch = inspection.launch;
        if (!launch) {
          return {
            client: inspection.client,
            serverName: inspection.serverName,
            command: "",
            args: [],
            ok: false,
            message: `${inspection.client} config is installed, but the launch command could not be read.`
          };
        }

        const resolved = await resolveExecutable(launch.command, env);
        return {
          client: inspection.client,
          serverName: inspection.serverName,
          command: launch.command,
          args: launch.args,
          ok: resolved !== null,
          message:
            resolved === null
              ? launchCommandMissingMessage(inspection.client, launch.command)
              : `${inspection.client} launch command is available: ${launch.command}`
        };
      })
  );
}

function launchCommandMissingMessage(
  client: SupportedClient,
  command: string
): string {
  if (isAbsolute(command)) {
    return `${client} config points to "${command}", but that executable is missing or not executable.`;
  }

  return `${client} config points to "${command}", but that executable is not available on PATH.`;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
}

async function readOptionalTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
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

async function backupExistingFile(path: string, now?: Date): Promise<string> {
  const baseBackupPath = `${path}.switchboard-backup-${backupTimestamp(now)}`;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const backupPath =
      attempt === 0 ? baseBackupPath : `${baseBackupPath}-${attempt}`;
    try {
      await copyFile(path, backupPath, constants.COPYFILE_EXCL);
      return backupPath;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`could not create a unique backup path for ${path}`);
}

function backupTimestamp(now: Date = new Date()): string {
  return now.toISOString().replaceAll(/[-:.]/g, "").replace("T", "-");
}

function mergeClientConfigContent(options: {
  client: SupportedClient;
  existing: string | null;
  renderedContent: string;
  serverName: string;
}): string {
  if (options.client === "claude") {
    return mergeClaudeConfigContent(options.existing, options.renderedContent);
  }

  return mergeCodexConfigContent(
    options.existing,
    options.renderedContent,
    options.serverName
  );
}

function mergeClaudeConfigContent(
  existing: string | null,
  renderedContent: string
): string {
  const rendered = JSON.parse(renderedContent) as {
    mcpServers: Record<string, unknown>;
  };
  const parsed = existing?.trim()
    ? (JSON.parse(existing) as Record<string, unknown>)
    : {};
  const existingServers =
    isRecord(parsed.mcpServers) && !Array.isArray(parsed.mcpServers)
      ? parsed.mcpServers
      : {};

  return `${JSON.stringify(
    {
      ...parsed,
      mcpServers: {
        ...existingServers,
        ...rendered.mcpServers
      }
    },
    null,
    2
  )}\n`;
}

function mergeCodexConfigContent(
  existing: string | null,
  renderedContent: string,
  serverName: string
): string {
  if (!existing?.trim()) {
    return `${renderedContent}\n`;
  }

  const lines = existing.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => codexMcpServerNameFromHeader(line) === serverName
  );
  const renderedLines = renderedContent.split("\n");

  if (start === -1) {
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    return `${existing}${separator}${renderedContent}\n`;
  }

  let end = start + 1;
  while (end < lines.length && !lines[end]?.trim().startsWith("[")) {
    end += 1;
  }

  lines.splice(start, end - start, ...renderedLines);
  return `${lines.join("\n").replace(/\n*$/, "")}\n`;
}

function inspectClaudeClientConfig(options: {
  existing: string;
  renderedContent: string;
  targetPath: string;
  serverName: string;
  scope: ClientConfigScope;
}): ProjectClientConfigInspection {
  const scopeLabel = options.scope === "user" ? "user" : "project";
  const parsed = JSON.parse(options.existing) as Record<string, unknown>;
  const rendered = JSON.parse(options.renderedContent) as {
    mcpServers: Record<string, unknown>;
  };
  const existingServers =
    isRecord(parsed.mcpServers) && !Array.isArray(parsed.mcpServers)
      ? parsed.mcpServers
      : {};
  const otherServerNames = Object.keys(existingServers).filter(
    (name) => name !== options.serverName
  );
  const actual = existingServers[options.serverName];
  const expected = rendered.mcpServers[options.serverName];

  if (actual === undefined) {
    return {
      client: "claude",
      scope: options.scope,
      serverName: options.serverName,
      targetPath: options.targetPath,
      status: "missing",
      message: `Claude ${scopeLabel} config does not include the Switchboard MCP server.`,
      otherServerNames,
      launch: null
    };
  }

  if (!clientServerEntryRoutesThroughSwitchboard(actual, expected, options.scope)) {
    return {
      client: "claude",
      scope: options.scope,
      serverName: options.serverName,
      targetPath: options.targetPath,
      status: "stale",
      message: `Claude ${scopeLabel} config has a different Switchboard MCP server entry.`,
      otherServerNames,
      launch: clientServerEntryLaunch(actual)
    };
  }

  return {
    client: "claude",
    scope: options.scope,
    serverName: options.serverName,
    targetPath: options.targetPath,
    status: "installed",
    message: `Claude ${scopeLabel} config routes through switchboard mcp.`,
    otherServerNames,
    launch: clientServerEntryLaunch(actual)
  };
}

function inspectCodexClientConfig(options: {
  existing: string;
  targetPath: string;
  serverName: string;
  command: string;
  commandArgs: string[];
  cwd: string;
  scope: ClientConfigScope;
}): ProjectClientConfigInspection {
  const scopeLabel = options.scope === "user" ? "user" : "project";
  const section = codexMcpServerSection(options.existing, options.serverName);
  const otherServerNames = codexMcpServerNames(options.existing).filter(
    (name) => name !== options.serverName
  );

  if (section === null) {
    return {
      client: "codex",
      scope: options.scope,
      serverName: options.serverName,
      targetPath: options.targetPath,
      status: "missing",
      message: `Codex ${scopeLabel} config does not include the Switchboard MCP server.`,
      otherServerNames,
      launch: null
    };
  }

  const values = parseSimpleTomlAssignments(section);
  const command = parseTomlString(values.command);
  const args = parseTomlStringArray(values.args);
  const cwd = parseTomlString(values.cwd);
  const expectedArgs =
    options.scope === "user"
      ? [...options.commandArgs, "mcp"]
      : [...options.commandArgs, "--cwd", options.cwd, "mcp"];
  // A user-scoped entry must stay repo-agnostic: any pinned cwd key would
  // lock every repo's session to one directory, so it is reported stale.
  const cwdIsStale =
    options.scope === "user"
      ? cwd !== undefined
      : cwd !== undefined && cwd !== options.cwd;

  if (
    !command ||
    cwdIsStale ||
    !args ||
    !launchArgsRouteThroughSwitchboard(args, expectedArgs, options.scope)
  ) {
    return {
      client: "codex",
      scope: options.scope,
      serverName: options.serverName,
      targetPath: options.targetPath,
      status: "stale",
      message: `Codex ${scopeLabel} config has a different Switchboard MCP server entry.`,
      otherServerNames,
      launch: command && args ? { command, args } : null
    };
  }

  return {
    client: "codex",
    scope: options.scope,
    serverName: options.serverName,
    targetPath: options.targetPath,
    status: "installed",
    message: `Codex ${scopeLabel} config routes through switchboard mcp.`,
    otherServerNames,
    launch: { command, args }
  };
}

function codexMcpServerNames(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map(codexMcpServerNameFromHeader)
    .filter((name): name is string => name !== null);
}

function clientServerEntryRoutesThroughSwitchboard(
  actual: unknown,
  expected: unknown,
  scope: ClientConfigScope = "project"
): boolean {
  if (!isRecord(actual) || !isRecord(expected)) {
    return false;
  }

  if (typeof actual.command !== "string" || actual.command.trim().length === 0) {
    return false;
  }

  if (!Array.isArray(actual.args) || !Array.isArray(expected.args)) {
    return false;
  }

  return (
    actual.args.every((arg) => typeof arg === "string") &&
    expected.args.every((arg) => typeof arg === "string") &&
    launchArgsRouteThroughSwitchboard(actual.args, expected.args, scope)
  );
}

function launchArgsRouteThroughSwitchboard(
  actual: string[],
  expected: string[],
  scope: ClientConfigScope = "project"
): boolean {
  if (scope === "user") {
    // User-scoped launches end in a bare `mcp` with no pinned --cwd; prefix
    // args such as `node <entrypoint>` are launcher detail, not routing.
    return actual.at(-1) === "mcp" && !actual.includes("--cwd");
  }

  const expectedPrefixLength = Math.max(0, expected.length - 3);
  if (expectedPrefixLength > 0) {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }

  if (actual.length < 3) {
    return false;
  }

  const suffix = actual.slice(-3);
  return JSON.stringify(suffix) === JSON.stringify(expected.slice(-3));
}

function clientServerEntryLaunch(
  entry: unknown
): ProjectClientConfigInspection["launch"] {
  if (!isRecord(entry) || typeof entry.command !== "string") {
    return null;
  }

  if (
    entry.args !== undefined &&
    (!Array.isArray(entry.args) ||
      !entry.args.every((arg) => typeof arg === "string"))
  ) {
    return null;
  }

  return {
    command: entry.command,
    args: Array.isArray(entry.args) ? entry.args : []
  };
}

function codexMcpServerSection(
  content: string,
  serverName: string
): string[] | null {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex(
    (line) => codexMcpServerNameFromHeader(line) === serverName
  );

  if (start === -1) {
    return null;
  }

  let end = start + 1;
  while (end < lines.length && !lines[end]?.trim().startsWith("[")) {
    end += 1;
  }

  return lines.slice(start + 1, end);
}

function parseSimpleTomlAssignments(lines: string[]): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf("=");
    if (separator === -1 || trimmed.startsWith("#")) {
      continue;
    }

    values[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim();
  }

  return values;
}

function parseTomlString(value: string | undefined): string | undefined {
  if (!value?.startsWith('"')) {
    return undefined;
  }

  return JSON.parse(value) as string;
}

function parseTomlStringArray(value: string | undefined): string[] | undefined {
  if (!value?.startsWith("[")) {
    return undefined;
  }

  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
    ? parsed
    : undefined;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function codexMcpServerNameFromHeader(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[mcp_servers.") || !trimmed.endsWith("]")) {
    return null;
  }

  const rawKey = trimmed.slice("[mcp_servers.".length, -1).trim();
  if (rawKey.startsWith('"') && rawKey.endsWith('"')) {
    try {
      return JSON.parse(rawKey) as string;
    } catch {
      return null;
    }
  }

  return rawKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function renderCodexConfig(options: {
  serverName: string;
  command: string;
  args: string[];
  cwd?: string;
}): string {
  return [
    `[mcp_servers.${tomlKey(options.serverName)}]`,
    `command = ${tomlString(options.command)}`,
    `args = ${tomlArray(options.args)}`,
    ...(options.cwd !== undefined ? [`cwd = ${tomlString(options.cwd)}`] : []),
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 60"
  ].join("\n");
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlKey(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

async function resolveExecutable(
  command: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  if (isAbsolute(command)) {
    return (await isExecutable(command)) ? command : null;
  }

  const path = env.PATH ?? "";
  for (const directory of path.split(delimiter)) {
    if (directory.length === 0) {
      continue;
    }

    const candidate = join(directory, command);
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
