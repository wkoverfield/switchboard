import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PathResolutionOptions } from "../config/paths.js";
import {
  resolveClaudeConfigDir,
  resolveClaudeUserSettingsPath,
  shellQuoteHookArg
} from "../hooks/claude-hooks.js";

/**
 * Spawn-time auto-attenuation for Claude Code subagents.
 *
 * Install writes two things into a target Claude Code user scope:
 *   1. A PreToolUse hook on the `Agent`/`Task` tool that rewrites a generic
 *      subagent spawn to the `scoped-worker` type (mechanism a).
 *   2. The `scoped-worker` agent definition, which hides the parent's open
 *      `mcp__switchboard` endpoint and carries an inline MCP server whose
 *      launcher mints a fresh attenuated child mandate per spawn.
 *
 * The merge is additive and reversible: the settings file is backed up before
 * a write, the hook entry is removed exactly on uninstall, and the
 * Switchboard-owned agent definition is created on install and removed on
 * uninstall. An install-then-uninstall round trip restores the structural
 * identity of the settings (byte identity when the pre-install file was
 * already canonically formatted) and leaves no agent definition behind when
 * install created it from nothing.
 *
 * Both the settings path and the agents directory derive from the injected
 * home dir, never a HOME override, so tests target a sandbox and never the
 * real `~/.claude`.
 */

export const scopedWorkerAgentName = "scoped-worker";
export const attenuationHookMatcher = "Agent|Task";
export const defaultAttenuationHookCommand =
  "switchboard attenuation rewrite-spawn";

// The uninstall discriminator: any PreToolUse command hook whose command
// ends with this suffix was written by Switchboard, whatever launcher prefix
// (global binary, npx, source checkout) the install used.
const attenuationHookCommandSuffix = " attenuation rewrite-spawn";

// Marker inside the agent definition body so uninstall only removes a
// Switchboard-authored scoped-worker, never a same-named file a user wrote.
const scopedWorkerMarker = "switchboard:scoped-worker";

// Subagent types a generic spawn uses; only these are redirected. A caller
// that spawns a specialized type keeps it (its identity is intentional).
const defaultRewrittenTypes = ["general-purpose", "claude"] as const;

export interface ClaudeAttenuationLaunch {
  /** Executable the scoped-worker launcher runs, e.g. `switchboard` or node. */
  command: string;
  /** Leading args before `mcp --mint-child`, e.g. a source entrypoint path. */
  commandArgs?: string[];
}

export interface ClaudeAttenuationWriteOptions extends PathResolutionOptions {
  /** Shell command Claude runs for the spawn-rewrite hook. */
  hookCommand?: string;
  /** Launch spec for the scoped-worker inline MCP server. */
  launch?: ClaudeAttenuationLaunch;
  now?: Date;
}

export interface InstalledClaudeAttenuation {
  settingsPath: string;
  agentPath: string;
  action: "created" | "updated" | "noop";
  settingsBackupPath: string | null;
  agentBackupPath: string | null;
  hookCommand: string;
  launcherCommand: string;
  launcherArgs: string[];
}

export interface UninstalledClaudeAttenuation {
  settingsPath: string;
  agentPath: string;
  action: "removed" | "noop";
  settingsBackupPath: string | null;
  agentBackupPath: string | null;
}

export type ClaudeAttenuationStatus = "installed" | "partial" | "missing";

export interface ClaudeAttenuationInspection {
  settingsPath: string;
  agentPath: string;
  status: ClaudeAttenuationStatus;
  hookInstalled: boolean;
  agentInstalled: boolean;
}

export function resolveScopedWorkerAgentPath(
  options: PathResolutionOptions = {}
): string {
  return join(
    resolveClaudeConfigDir(options),
    "agents",
    `${scopedWorkerAgentName}.md`
  );
}

export function isAttenuationHookCommand(command: string): boolean {
  return (
    command === defaultAttenuationHookCommand ||
    command.endsWith(attenuationHookCommandSuffix)
  );
}

/** Build the spawn-rewrite hook command from a launch spec. */
export function attenuationHookCommandFromLaunch(
  launch: ClaudeAttenuationLaunch
): string {
  return [launch.command, ...(launch.commandArgs ?? []), "attenuation", "rewrite-spawn"]
    .map(shellQuoteHookArg)
    .join(" ");
}

/** The argv the scoped-worker inline MCP server launches to mint a child. */
export function scopedWorkerLauncher(
  launch: ClaudeAttenuationLaunch = { command: "switchboard" }
): { command: string; args: string[] } {
  return {
    command: launch.command,
    args: [...(launch.commandArgs ?? []), "mcp", "--mint-child"]
  };
}

/**
 * The pure spawn-rewrite decision. Returns the hook's stdout object when a
 * generic spawn should be redirected to the scoped worker, or null to defer
 * to the harness (no output). Never throws on shape it does not recognize;
 * the runtime wraps it to fail open.
 */
export function attenuationRewriteSpawnDecision(input: {
  tool_name?: unknown;
  tool_input?: unknown;
}): {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "allow";
    permissionDecisionReason: string;
    updatedInput: Record<string, unknown>;
  };
} | null {
  const toolInput =
    typeof input.tool_input === "object" && input.tool_input !== null
      ? (input.tool_input as Record<string, unknown>)
      : undefined;
  if (!toolInput) {
    return null;
  }

  const requestedType =
    typeof toolInput.subagent_type === "string"
      ? toolInput.subagent_type
      : "general-purpose";
  if (!defaultRewrittenTypes.includes(requestedType as never)) {
    return null;
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason:
        "auto-attenuation: redirected spawn to scoped-worker (fresh child mandate, own audit identity, seatbelt floor)",
      updatedInput: { ...toolInput, subagent_type: scopedWorkerAgentName }
    }
  };
}

export function renderScopedWorkerAgentDefinition(
  launch: ClaudeAttenuationLaunch = { command: "switchboard" }
): string {
  const launcher = scopedWorkerLauncher(launch);
  const argLines = launcher.args
    .map((arg) => `        - ${JSON.stringify(arg)}`)
    .join("\n");
  return [
    "---",
    `name: ${scopedWorkerAgentName}`,
    "description: Worker subagent that runs against a freshly-minted, attenuated Switchboard child mandate instead of the parent session's open endpoint. Use for any delegated task that touches provider tools.",
    "disallowedTools: mcp__switchboard",
    "mcpServers:",
    "  - switchboard-scoped:",
    "      type: stdio",
    `      command: ${JSON.stringify(launcher.command)}`,
    "      args:",
    argLines,
    "---",
    "",
    `<!-- ${scopedWorkerMarker} -->`,
    "You are a scoped worker. Your provider tools come from the `switchboard-scoped`",
    "MCP server, which carries a narrowed authority mandate minted for this run: its",
    "own id, its own audit trail, a lease bound to the parent, and the seatbelt floor.",
    "Attempt exactly what the task asks. If a tool is denied or missing, report the",
    "denial verbatim rather than working around it.",
    ""
  ].join("\n");
}

export async function installClaudeAttenuation(
  options: ClaudeAttenuationWriteOptions = {}
): Promise<InstalledClaudeAttenuation> {
  const settingsPath = resolveClaudeUserSettingsPath(options);
  const agentPath = resolveScopedWorkerAgentPath(options);
  const launch = options.launch ?? { command: "switchboard" };
  const hookCommand =
    options.hookCommand ?? attenuationHookCommandFromLaunch(launch);
  assertAttenuationHookCommand(hookCommand);
  const launcher = scopedWorkerLauncher(launch);

  const existingSettings = await readOptionalTextFile(settingsPath);
  const parsed = parseSettings(existingSettings, settingsPath);
  const existingAgent = await readOptionalTextFile(agentPath);

  if (existingAgent !== null && !existingAgent.includes(scopedWorkerMarker)) {
    throw new Error(
      `${agentPath} already exists and was not written by Switchboard; move it aside before installing attenuation`
    );
  }

  const hookAlreadyInstalled = installedHookCommands(parsed).includes(
    hookCommand
  );
  const desiredAgent = renderScopedWorkerAgentDefinition(launch);
  const agentAlreadyInstalled = existingAgent === desiredAgent;

  if (hookAlreadyInstalled && agentAlreadyInstalled) {
    return {
      settingsPath,
      agentPath,
      action: "noop",
      settingsBackupPath: null,
      agentBackupPath: null,
      hookCommand,
      launcherCommand: launcher.command,
      launcherArgs: launcher.args
    };
  }

  // Any previous Switchboard entry (an older launcher path, for example) is
  // replaced rather than accumulated.
  const cleaned = withoutAttenuationHooks(parsed);
  const next = withAttenuationHook(cleaned, hookCommand);

  let settingsBackupPath: string | null = null;
  if (!hookAlreadyInstalled) {
    await mkdir(dirname(settingsPath), { recursive: true });
    settingsBackupPath =
      existingSettings === null
        ? null
        : await backupExistingFile(settingsPath, options.now);
    await writeFile(settingsPath, serializeSettings(next), "utf8");
  }

  let agentBackupPath: string | null = null;
  if (!agentAlreadyInstalled) {
    await mkdir(dirname(agentPath), { recursive: true });
    agentBackupPath =
      existingAgent === null
        ? null
        : await backupExistingFile(agentPath, options.now);
    await writeFile(agentPath, desiredAgent, "utf8");
  }

  return {
    settingsPath,
    agentPath,
    action: existingSettings === null && existingAgent === null
      ? "created"
      : "updated",
    settingsBackupPath,
    agentBackupPath,
    hookCommand,
    launcherCommand: launcher.command,
    launcherArgs: launcher.args
  };
}

export async function uninstallClaudeAttenuation(
  options: ClaudeAttenuationWriteOptions = {}
): Promise<UninstalledClaudeAttenuation> {
  const settingsPath = resolveClaudeUserSettingsPath(options);
  const agentPath = resolveScopedWorkerAgentPath(options);

  const existingSettings = await readOptionalTextFile(settingsPath);
  const existingAgent = await readOptionalTextFile(agentPath);

  const parsed =
    existingSettings === null
      ? {}
      : parseSettings(existingSettings, settingsPath);
  const hookInstalled = installedHookCommands(parsed).length > 0;
  const agentInstalled =
    existingAgent !== null && existingAgent.includes(scopedWorkerMarker);

  if (!hookInstalled && !agentInstalled) {
    return {
      settingsPath,
      agentPath,
      action: "noop",
      settingsBackupPath: null,
      agentBackupPath: null
    };
  }

  let settingsBackupPath: string | null = null;
  if (hookInstalled && existingSettings !== null) {
    const next = withoutAttenuationHooks(parsed);
    settingsBackupPath = await backupExistingFile(settingsPath, options.now);
    if (Object.keys(next).length === 0) {
      await rm(settingsPath);
    } else {
      await writeFile(settingsPath, serializeSettings(next), "utf8");
    }
  }

  let agentBackupPath: string | null = null;
  if (agentInstalled) {
    agentBackupPath = await backupExistingFile(agentPath, options.now);
    await rm(agentPath);
  }

  return {
    settingsPath,
    agentPath,
    action: "removed",
    settingsBackupPath,
    agentBackupPath
  };
}

export async function inspectClaudeAttenuation(
  options: PathResolutionOptions = {}
): Promise<ClaudeAttenuationInspection> {
  const settingsPath = resolveClaudeUserSettingsPath(options);
  const agentPath = resolveScopedWorkerAgentPath(options);
  const existingSettings = await readOptionalTextFile(settingsPath);
  const existingAgent = await readOptionalTextFile(agentPath);

  let hookInstalled = false;
  if (existingSettings !== null) {
    try {
      hookInstalled =
        installedHookCommands(parseSettings(existingSettings, settingsPath))
          .length > 0;
    } catch {
      hookInstalled = false;
    }
  }
  const agentInstalled =
    existingAgent !== null && existingAgent.includes(scopedWorkerMarker);

  const status: ClaudeAttenuationStatus =
    hookInstalled && agentInstalled
      ? "installed"
      : hookInstalled || agentInstalled
        ? "partial"
        : "missing";

  return { settingsPath, agentPath, status, hookInstalled, agentInstalled };
}

function assertAttenuationHookCommand(command: string): void {
  if (!isAttenuationHookCommand(command)) {
    throw new Error(
      `attenuation hook command must end with "${attenuationHookCommandSuffix.trim()}" so uninstall can identify it: ${command}`
    );
  }
}

function installedHookCommands(settings: Record<string, unknown>): string[] {
  const commands: string[] = [];
  for (const entry of preToolUseEntries(settings)) {
    for (const hook of entry.hooks) {
      if (isAttenuationHookCommand(hook.command)) {
        commands.push(hook.command);
      }
    }
  }
  return commands;
}

interface HookEntry {
  matcher: string;
  hooks: Array<{ type: "command"; command: string }>;
}

function withAttenuationHook(
  settings: Record<string, unknown>,
  hookCommand: string
): Record<string, unknown> {
  const hooks = isRecord(settings.hooks) ? { ...settings.hooks } : {};
  const preToolUse = Array.isArray(hooks.PreToolUse)
    ? [...(hooks.PreToolUse as unknown[])]
    : [];
  preToolUse.push({
    matcher: attenuationHookMatcher,
    hooks: [{ type: "command", command: hookCommand }]
  });

  return { ...settings, hooks: { ...hooks, PreToolUse: preToolUse } };
}

function withoutAttenuationHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  if (!isRecord(settings.hooks) || !Array.isArray(settings.hooks.PreToolUse)) {
    return settings;
  }

  const preToolUse: unknown[] = [];
  for (const rawEntry of settings.hooks.PreToolUse as unknown[]) {
    const entry = asHookEntry(rawEntry);
    if (entry === null) {
      preToolUse.push(rawEntry);
      continue;
    }

    const kept = entry.hooks.filter(
      (hook) => !isAttenuationHookCommand(hook.command)
    );
    if (kept.length === entry.hooks.length) {
      preToolUse.push(rawEntry);
    } else if (kept.length > 0) {
      preToolUse.push({ ...(rawEntry as Record<string, unknown>), hooks: kept });
    }
    // An entry left with no hooks is dropped entirely.
  }

  const hooks = { ...settings.hooks } as Record<string, unknown>;
  if (preToolUse.length > 0) {
    hooks.PreToolUse = preToolUse;
  } else {
    delete hooks.PreToolUse;
  }

  const next = { ...settings };
  if (Object.keys(hooks).length > 0) {
    next.hooks = hooks;
  } else {
    delete next.hooks;
  }

  return next;
}

function preToolUseEntries(settings: Record<string, unknown>): HookEntry[] {
  if (!isRecord(settings.hooks) || !Array.isArray(settings.hooks.PreToolUse)) {
    return [];
  }

  const entries: HookEntry[] = [];
  for (const rawEntry of settings.hooks.PreToolUse as unknown[]) {
    const entry = asHookEntry(rawEntry);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

function asHookEntry(value: unknown): HookEntry | null {
  if (!isRecord(value) || !Array.isArray(value.hooks)) {
    return null;
  }

  const hooks: HookEntry["hooks"] = [];
  for (const hook of value.hooks as unknown[]) {
    if (
      !isRecord(hook) ||
      hook.type !== "command" ||
      typeof hook.command !== "string"
    ) {
      return null;
    }
    hooks.push({ type: "command", command: hook.command });
  }

  return {
    matcher: typeof value.matcher === "string" ? value.matcher : "",
    hooks
  };
}

function parseSettings(
  content: string | null,
  path: string
): Record<string, unknown> {
  if (content === null || content.trim().length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }

  return parsed;
}

function serializeSettings(settings: Record<string, unknown>): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

async function readOptionalTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
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
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
