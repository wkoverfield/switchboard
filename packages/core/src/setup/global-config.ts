import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { deepMerge } from "../config/load-config.js";
import {
  type PathResolutionOptions,
  resolveGlobalConfigPath
} from "../config/paths.js";

export type GlobalConfigHooksSetting = "enabled" | "disabled";

export interface WriteGlobalConfigOptions extends PathResolutionOptions {
  /**
   * Recorded under `setup.hooks`. When omitted, an already-recorded value is
   * preserved and new files default to "enabled".
   */
  hooks?: GlobalConfigHooksSetting;
  now?: Date;
}

export interface WrittenGlobalConfig {
  path: string;
  action: "created" | "updated" | "noop";
  backupPath: string | null;
  hooks: GlobalConfigHooksSetting;
}

const policiesBlock = [
  "# Machine-level policy stanzas (policySchema: defaultMode,",
  '# requireConfirmation, hideTools, seatbelt). The "default" stanza is the',
  "# machine-wide agent policy. Empty means the built-in seatbelt",
  "# catastrophe denylist applies unchanged; tune it with, for example:",
  "#   default:",
  "#     seatbelt:",
  "#       add:",
  "#         - name: my-pattern",
  '#           pattern: "\\\\bmy-cli\\\\s+launch-prod\\\\b"',
  '#           reason: "launches production"',
  "#       remove: [route53-record-change]",
  '# Turn the seatbelt off entirely with a top-level "seatbelt: off" line.',
  "policies:",
  "  default: {}"
].join("\n");

function setupBlock(hooks: GlobalConfigHooksSetting): string {
  return [
    "# Written by switchboard setup. `hooks` records whether agent-client",
    "# hook installation is enabled or disabled on this machine.",
    "setup:",
    `  hooks: ${hooks}`
  ].join("\n");
}

export function renderGlobalConfigSeed(
  hooks: GlobalConfigHooksSetting
): string {
  return [
    "# Switchboard machine-level config (switchboardConfigSchema).",
    "# Layered under any repo .switchboard.yaml; repo config wins on conflict.",
    "version: 1",
    "",
    policiesBlock,
    "",
    setupBlock(hooks),
    ""
  ].join("\n");
}

/**
 * Create or repair the machine-level config file at
 * `$XDG_CONFIG_HOME/switchboard/config.yaml` (or `~/.config/...`).
 *
 * The write is idempotent: a file that already carries the managed keys is
 * left untouched (no rewrite, no backup). When an existing file needs new
 * top-level sections they are appended as text so hand-written comments
 * survive; only a change inside an existing section rewrites the file
 * through the YAML printer, always behind a timestamped backup.
 */
export async function writeGlobalSwitchboardConfig(
  options: WriteGlobalConfigOptions = {}
): Promise<WrittenGlobalConfig> {
  const path = resolveGlobalConfigPath(options);
  const existing = await readOptionalTextFile(path);

  if (existing === null) {
    const hooks = options.hooks ?? "enabled";
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderGlobalConfigSeed(hooks), "utf8");
    return { path, action: "created", backupPath: null, hooks };
  }

  const parsed = parseGlobalConfigYaml(existing, path);
  const recordedHooks = recordedHooksSetting(parsed);
  const hooks = options.hooks ?? recordedHooks ?? "enabled";
  const hasPolicies = "policies" in parsed;
  const hasSetup = "setup" in parsed;
  const policiesSatisfied =
    isRecord(parsed.policies) && "default" in parsed.policies;
  const hooksSatisfied = recordedHooks === hooks;

  if (policiesSatisfied && hooksSatisfied) {
    return { path, action: "noop", backupPath: null, hooks };
  }

  // Missing top-level sections are appended as text so hand-written
  // comments survive; only a change inside an existing section (a policies
  // mapping without "default", or a different recorded hooks value) falls
  // through to the YAML printer, which drops comments but runs behind a
  // backup.
  let nextContent: string;
  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  if (!hasPolicies && !hasSetup) {
    nextContent = `${existing}${separator}${policiesBlock}\n\n${setupBlock(hooks)}\n`;
  } else if (policiesSatisfied && !hasSetup) {
    nextContent = `${existing}${separator}${setupBlock(hooks)}\n`;
  } else if (!hasPolicies && hooksSatisfied) {
    nextContent = `${existing}${separator}${policiesBlock}\n`;
  } else {
    const merged = deepMerge(parsed, {
      policies: { default: defaultPolicyStanza(parsed) },
      setup: { hooks }
    });
    nextContent = stringifyYaml(merged, { lineWidth: 0 });
  }

  const backupPath = await backupExistingFile(path, options.now);
  await writeFile(path, nextContent, "utf8");
  return { path, action: "updated", backupPath, hooks };
}

function defaultPolicyStanza(
  parsed: Record<string, unknown>
): Record<string, unknown> {
  if (isRecord(parsed.policies) && isRecord(parsed.policies.default)) {
    return parsed.policies.default;
  }

  return {};
}

function recordedHooksSetting(
  parsed: Record<string, unknown>
): GlobalConfigHooksSetting | null {
  if (!isRecord(parsed.setup)) {
    return null;
  }

  const value = parsed.setup.hooks;
  return value === "enabled" || value === "disabled" ? value : null;
}

function parseGlobalConfigYaml(
  content: string,
  path: string
): Record<string, unknown> {
  const parsed = content.trim().length === 0 ? {} : parseYaml(content);
  if (parsed === null || parsed === undefined) {
    return {};
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must be a YAML mapping`);
  }

  return parsed as Record<string, unknown>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
