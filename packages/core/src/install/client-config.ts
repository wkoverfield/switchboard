import { constants } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";

export type SupportedClient = "codex" | "claude";

export interface SwitchboardClientConfigOptions {
  client: SupportedClient;
  serverName?: string;
  command?: string;
  cwd: string;
}

export interface RenderedClientConfig {
  client: SupportedClient;
  serverName: string;
  target: string;
  content: string;
}

export interface WrittenClientConfig {
  client: SupportedClient;
  serverName: string;
  targetPath: string;
  backupPath: string | null;
  action: "created" | "updated";
}

export interface RolledBackClientConfig {
  client: SupportedClient;
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
  serverName: string;
  targetPath: string;
  status: ProjectClientConfigStatus;
  message: string;
  otherServerNames: string[];
}

const defaultServerName = "switchboard";
const defaultCommand = "switchboard";

export function renderSwitchboardClientConfig(
  options: SwitchboardClientConfigOptions
): RenderedClientConfig {
  const serverName = options.serverName ?? defaultServerName;
  const command = options.command ?? defaultCommand;
  const args = ["--cwd", options.cwd, "mcp"];
  const validation = validateSwitchboardClientConfigOptions({
    ...options,
    serverName,
    command
  });

  if (!validation.ok) {
    throw new Error(validation.errors.join("\n"));
  }

  if (options.client === "codex") {
    return {
      client: "codex",
      serverName,
      target: "~/.codex/config.toml or .codex/config.toml",
      content: renderCodexConfig({ serverName, command, args, cwd: options.cwd })
    };
  }

  return {
    client: "claude",
    serverName,
    target: ".mcp.json for project scope or ~/.claude.json for local/user scope",
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
  const rendered = renderSwitchboardClientConfig(options);
  const targetPath = resolveProjectClientConfigPath(options.client, options.cwd);
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
  now?: Date;
}): Promise<RolledBackClientConfig> {
  const targetPath = resolveProjectClientConfigPath(options.client, options.cwd);
  const backupContent = await readFile(options.backupPath, "utf8");
  const existing = await readOptionalTextFile(targetPath);

  await mkdir(dirname(targetPath), { recursive: true });
  const currentBackupPath = existing
    ? await backupExistingFile(targetPath, options.now)
    : null;
  await writeFile(targetPath, backupContent, "utf8");

  return {
    client: options.client,
    targetPath,
    restoredFrom: options.backupPath,
    backupPath: currentBackupPath
  };
}

export function resolveProjectClientConfigPath(
  client: SupportedClient,
  cwd: string
): string {
  if (client === "codex") {
    return join(cwd, ".codex", "config.toml");
  }

  return join(cwd, ".mcp.json");
}

export async function inspectProjectClientConfig(
  options: SwitchboardClientConfigOptions
): Promise<ProjectClientConfigInspection> {
  const rendered = renderSwitchboardClientConfig(options);
  const targetPath = resolveProjectClientConfigPath(options.client, options.cwd);
  const existing = await readOptionalTextFile(targetPath);

  if (existing === null) {
    return {
      client: options.client,
      serverName: rendered.serverName,
      targetPath,
      status: "missing",
      message: "Project client config file was not found.",
      otherServerNames: []
    };
  }

  try {
    if (options.client === "claude") {
      return inspectClaudeProjectConfig({
        existing,
        renderedContent: rendered.content,
        targetPath,
        serverName: rendered.serverName
      });
    }

    return inspectCodexProjectConfig({
      existing,
      targetPath,
      serverName: rendered.serverName,
      command: options.command ?? defaultCommand,
      cwd: options.cwd
    });
  } catch (error) {
    return {
      client: options.client,
      serverName: rendered.serverName,
      targetPath,
      status: "invalid",
      message: messageFromError(error),
      otherServerNames: []
    };
  }
}

export async function inspectProjectClientConfigs(options: {
  cwd: string;
  serverName?: string;
  command?: string;
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

  return { ok: errors.length === 0, errors };
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

function inspectClaudeProjectConfig(options: {
  existing: string;
  renderedContent: string;
  targetPath: string;
  serverName: string;
}): ProjectClientConfigInspection {
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
      serverName: options.serverName,
      targetPath: options.targetPath,
      status: "missing",
      message: "Claude project config does not include the Switchboard MCP server.",
      otherServerNames
    };
  }

  if (!clientServerEntryRoutesThroughSwitchboard(actual, expected)) {
    return {
      client: "claude",
      serverName: options.serverName,
      targetPath: options.targetPath,
      status: "stale",
      message: "Claude project config has a different Switchboard MCP server entry.",
      otherServerNames
    };
  }

  return {
    client: "claude",
    serverName: options.serverName,
    targetPath: options.targetPath,
    status: "installed",
    message: "Claude project config routes through switchboard mcp.",
    otherServerNames
  };
}

function inspectCodexProjectConfig(options: {
  existing: string;
  targetPath: string;
  serverName: string;
  command: string;
  cwd: string;
}): ProjectClientConfigInspection {
  const section = codexMcpServerSection(options.existing, options.serverName);
  const otherServerNames = codexMcpServerNames(options.existing).filter(
    (name) => name !== options.serverName
  );

  if (section === null) {
    return {
      client: "codex",
      serverName: options.serverName,
      targetPath: options.targetPath,
      status: "missing",
      message: "Codex project config does not include the Switchboard MCP server.",
      otherServerNames
    };
  }

  const values = parseSimpleTomlAssignments(section);
  const command = parseTomlString(values.command);
  const args = parseTomlStringArray(values.args);
  const cwd = parseTomlString(values.cwd);

  if (
    command !== options.command ||
    (cwd !== undefined && cwd !== options.cwd) ||
    !args ||
    args.length !== 3 ||
    args[0] !== "--cwd" ||
    args[1] !== options.cwd ||
    args[2] !== "mcp"
  ) {
    return {
      client: "codex",
      serverName: options.serverName,
      targetPath: options.targetPath,
      status: "stale",
      message: "Codex project config has a different Switchboard MCP server entry.",
      otherServerNames
    };
  }

  return {
    client: "codex",
    serverName: options.serverName,
    targetPath: options.targetPath,
    status: "installed",
    message: "Codex project config routes through switchboard mcp.",
    otherServerNames
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
  expected: unknown
): boolean {
  if (!isRecord(actual) || !isRecord(expected)) {
    return false;
  }

  return (
    actual.command === expected.command &&
    JSON.stringify(actual.args) === JSON.stringify(expected.args)
  );
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
  cwd: string;
}): string {
  return [
    `[mcp_servers.${tomlKey(options.serverName)}]`,
    `command = ${tomlString(options.command)}`,
    `args = ${tomlArray(options.args)}`,
    `cwd = ${tomlString(options.cwd)}`,
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
