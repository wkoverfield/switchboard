import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { PathResolutionOptions } from "../config/paths.js";

/**
 * Manage the Switchboard Bash tripwire in user-scope Claude Code settings
 * (`~/.claude/settings.json`). Install merges a single PreToolUse entry and
 * never touches anything else in the file; uninstall removes exactly that
 * entry (and any containers the removal leaves empty), so an
 * install-then-uninstall round trip leaves the settings byte-identical.
 * Existing files are always backed up before a write.
 */

export interface ClaudeHookEntry {
  matcher: string;
  hooks: Array<{ type: "command"; command: string }>;
}

export interface ClaudeHooksWriteOptions extends PathResolutionOptions {
  /** Shell command Claude runs for the hook; defaults to the installed CLI. */
  hookCommand?: string;
  now?: Date;
}

export interface InstalledClaudeHooks {
  targetPath: string;
  action: "created" | "updated" | "noop";
  backupPath: string | null;
  hookCommand: string;
}

export interface UninstalledClaudeHooks {
  targetPath: string;
  action: "removed" | "noop";
  backupPath: string | null;
}

export type ClaudeHooksStatus = "installed" | "missing" | "invalid";

export interface ClaudeHooksInspection {
  targetPath: string;
  status: ClaudeHooksStatus;
  /** The tripwire commands currently installed (empty unless installed). */
  hookCommands: string[];
}

export const defaultClaudeHookCommand = "switchboard hooks check";

// The uninstall discriminator: any PreToolUse command hook whose command
// ends with this suffix was written by Switchboard, whatever launcher
// prefix (global binary, npx, source checkout) the install used.
const hookCommandSuffix = " hooks check";

export function resolveClaudeUserSettingsPath(
  options: PathResolutionOptions = {}
): string {
  const home = options.homeDir ?? homedir();
  return join(home, ".claude", "settings.json");
}

/** Quote one argv token for a POSIX shell command string. */
export function shellQuoteHookArg(value: string): string {
  return /^[A-Za-z0-9_./:=-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", "'\\''")}'`;
}

/** Build the hook shell command from a launch spec, e.g. node + entrypoint. */
export function claudeHookCommandFromLaunch(options: {
  command: string;
  commandArgs?: string[];
}): string {
  return [options.command, ...(options.commandArgs ?? []), "hooks", "check"]
    .map(shellQuoteHookArg)
    .join(" ");
}

export async function installClaudeHooks(
  options: ClaudeHooksWriteOptions = {}
): Promise<InstalledClaudeHooks> {
  const targetPath = resolveClaudeUserSettingsPath(options);
  const hookCommand = options.hookCommand ?? defaultClaudeHookCommand;
  assertSwitchboardHookCommand(hookCommand);
  const existing = await readOptionalTextFile(targetPath);
  const parsed = parseSettings(existing, targetPath);

  if (installedHookCommands(parsed).includes(hookCommand)) {
    return { targetPath, action: "noop", backupPath: null, hookCommand };
  }

  // Any previous Switchboard entry (an older launcher path, for example) is
  // replaced rather than accumulated.
  const cleaned = withoutSwitchboardHooks(parsed);
  const next = withSwitchboardHook(cleaned, hookCommand);

  await mkdir(dirname(targetPath), { recursive: true });
  const backupPath =
    existing === null ? null : await backupExistingFile(targetPath, options.now);
  await writeFile(targetPath, serializeSettings(next), "utf8");

  return {
    targetPath,
    action: existing === null ? "created" : "updated",
    backupPath,
    hookCommand
  };
}

export async function uninstallClaudeHooks(
  options: ClaudeHooksWriteOptions = {}
): Promise<UninstalledClaudeHooks> {
  const targetPath = resolveClaudeUserSettingsPath(options);
  const existing = await readOptionalTextFile(targetPath);
  if (existing === null) {
    return { targetPath, action: "noop", backupPath: null };
  }

  const parsed = parseSettings(existing, targetPath);
  if (installedHookCommands(parsed).length === 0) {
    return { targetPath, action: "noop", backupPath: null };
  }

  const next = withoutSwitchboardHooks(parsed);
  const backupPath = await backupExistingFile(targetPath, options.now);
  if (Object.keys(next).length === 0) {
    // Install created this file from nothing; removal restores that nothing.
    await rm(targetPath);
  } else {
    await writeFile(targetPath, serializeSettings(next), "utf8");
  }

  return { targetPath, action: "removed", backupPath };
}

export async function inspectClaudeHooks(
  options: PathResolutionOptions = {}
): Promise<ClaudeHooksInspection> {
  const targetPath = resolveClaudeUserSettingsPath(options);
  const existing = await readOptionalTextFile(targetPath);
  if (existing === null) {
    return { targetPath, status: "missing", hookCommands: [] };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseSettings(existing, targetPath);
  } catch {
    return { targetPath, status: "invalid", hookCommands: [] };
  }

  const hookCommands = installedHookCommands(parsed);
  return {
    targetPath,
    status: hookCommands.length > 0 ? "installed" : "missing",
    hookCommands
  };
}

export function isSwitchboardHookCommand(command: string): boolean {
  return (
    command === defaultClaudeHookCommand || command.endsWith(hookCommandSuffix)
  );
}

function assertSwitchboardHookCommand(command: string): void {
  if (!isSwitchboardHookCommand(command)) {
    throw new Error(
      `Claude hook command must end with "${hookCommandSuffix.trim()}" so uninstall can identify it: ${command}`
    );
  }
}

function installedHookCommands(settings: Record<string, unknown>): string[] {
  const commands: string[] = [];
  for (const entry of preToolUseEntries(settings)) {
    for (const hook of entry.hooks) {
      if (isSwitchboardHookCommand(hook.command)) {
        commands.push(hook.command);
      }
    }
  }
  return commands;
}

function withSwitchboardHook(
  settings: Record<string, unknown>,
  hookCommand: string
): Record<string, unknown> {
  const hooks = isRecord(settings.hooks) ? { ...settings.hooks } : {};
  const preToolUse = Array.isArray(hooks.PreToolUse)
    ? [...(hooks.PreToolUse as unknown[])]
    : [];
  preToolUse.push({
    matcher: "Bash",
    hooks: [{ type: "command", command: hookCommand }]
  });

  return {
    ...settings,
    hooks: { ...hooks, PreToolUse: preToolUse }
  };
}

function withoutSwitchboardHooks(
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
      (hook) => !isSwitchboardHookCommand(hook.command)
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

function preToolUseEntries(
  settings: Record<string, unknown>
): ClaudeHookEntry[] {
  if (!isRecord(settings.hooks) || !Array.isArray(settings.hooks.PreToolUse)) {
    return [];
  }

  const entries: ClaudeHookEntry[] = [];
  for (const rawEntry of settings.hooks.PreToolUse as unknown[]) {
    const entry = asHookEntry(rawEntry);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

function asHookEntry(value: unknown): ClaudeHookEntry | null {
  if (!isRecord(value) || !Array.isArray(value.hooks)) {
    return null;
  }

  const hooks: ClaudeHookEntry["hooks"] = [];
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
