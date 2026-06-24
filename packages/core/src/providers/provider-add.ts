import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { deepMerge } from "../config/load-config.js";
import { resolveRepoConfigPaths } from "../config/paths.js";
import {
  type SwitchboardConfig,
  switchboardConfigSchema
} from "../schemas/config.js";
import {
  renderProviderSafetyTemplate,
  type RenderProviderSafetyTemplateOptions,
  type RenderedProviderSafetyTemplate
} from "./provider-templates.js";

export interface ProviderAddPlanOptions extends RenderProviderSafetyTemplateOptions {
  id: string;
  cwd?: string;
  now?: Date;
}

export interface ProviderAddPlan {
  id: string;
  targetPath: string;
  exists: boolean;
  rendered: RenderedProviderSafetyTemplate;
  nextContent: string;
  secretCommands: string[];
  checkCommand: string;
  installCommands: string[];
  mandateCommand: string;
}

export interface WrittenProviderAddPlan {
  plan: ProviderAddPlan;
  action: "created" | "updated";
  backupPath: string | null;
}

export async function createProviderAddPlan(
  options: ProviderAddPlanOptions
): Promise<ProviderAddPlan> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const targetPath = resolveProviderAddTargetPath(cwd);
  const existing = await readOptionalTextFile(targetPath);
  const rendered = renderProviderSafetyTemplate(options.id, {
    ...(options.profileName ? { profileName: options.profileName } : {}),
    ...(options.namespace ? { namespace: options.namespace } : {}),
    ...(options.secretRef ? { secretRef: options.secretRef } : {}),
    ...(options.command ? { command: options.command } : {}),
    ...(options.args ? { args: options.args } : {}),
    ...(options.mandateBranch ? { mandateBranch: options.mandateBranch } : {})
  });
  const nextContent = renderMergedProviderConfig(existing, rendered.configYaml);

  return {
    id: options.id,
    targetPath,
    exists: existing !== null,
    rendered,
    nextContent,
    secretCommands: rendered.secretCommands,
    checkCommand: `switchboard presets check ${options.id} --profile ${rendered.profileName}`,
    installCommands: [
      "switchboard install codex --write",
      "switchboard install claude --write"
    ],
    mandateCommand: renderPresetMandateCommand(rendered)
  };
}

function renderPresetMandateCommand(
  rendered: RenderedProviderSafetyTemplate
): string {
  return [
    "switchboard",
    "mandate",
    "create",
    rendered.template.recommendedMandate.task,
    "--from",
    rendered.template.id,
    "--profiles",
    rendered.profileName
  ]
    .map(shellQuoteIfNeeded)
    .join(" ");
}

function resolveProviderAddTargetPath(cwd: string): string {
  return (
    resolveRepoConfigPaths({ cwd }).repoConfigPath ??
    join(cwd, ".switchboard.yaml")
  );
}

export async function writeProviderAddPlan(
  options: ProviderAddPlanOptions
): Promise<WrittenProviderAddPlan> {
  const plan = await createProviderAddPlan(options);
  const existing = await readOptionalTextFile(plan.targetPath);
  await mkdir(dirname(plan.targetPath), { recursive: true });
  const backupPath = existing
    ? await backupExistingFile(plan.targetPath, options.now)
    : null;
  await writeFile(plan.targetPath, plan.nextContent, "utf8");

  return {
    plan,
    action: existing ? "updated" : "created",
    backupPath
  };
}

function renderMergedProviderConfig(
  existingContent: string | null,
  renderedContent: string
): string {
  const rendered = parseConfigYaml(renderedContent, "rendered provider config");
  if (!existingContent?.trim()) {
    return `${stringifyYaml(rendered, { lineWidth: 0 })}`;
  }

  const existing = parseConfigYaml(existingContent, ".switchboard.yaml");
  const merged = mergeProviderConfig(existing, rendered);
  const parsed = switchboardConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("\n"));
  }

  return `${stringifyYaml(ensureDefaultWorkspaceProfile(parsed.data), {
    lineWidth: 0
  })}`;
}

function ensureDefaultWorkspaceProfile(config: SwitchboardConfig): SwitchboardConfig {
  const defaultWorkspace = config.workspaces.default;
  if (!defaultWorkspace) {
    return config;
  }

  return {
    ...config,
    workspaces: {
      ...config.workspaces,
      default: {
        ...defaultWorkspace,
        profiles: unique(defaultWorkspace.profiles)
      }
    }
  };
}

function mergeProviderConfig(
  existing: Record<string, unknown>,
  rendered: Record<string, unknown>
): Record<string, unknown> {
  const existingParsed = switchboardConfigSchema.safeParse(existing);
  const renderedParsed = switchboardConfigSchema.safeParse(rendered);
  const merged = deepMerge(existing, rendered);
  if (!existingParsed.success || !renderedParsed.success) {
    return merged;
  }

  const existingDefault = existingParsed.data.workspaces.default;
  const renderedDefault = renderedParsed.data.workspaces.default;
  if (!existingDefault || !renderedDefault) {
    return merged;
  }

  return deepMerge(merged, {
    workspaces: {
      default: {
        paths: unique([...existingDefault.paths, ...renderedDefault.paths]),
        profiles: unique([
          ...existingDefault.profiles,
          ...renderedDefault.profiles
        ]),
        defaultEnvironment:
          existingDefault.defaultEnvironment ?? renderedDefault.defaultEnvironment
      }
    }
  });
}

function parseConfigYaml(content: string, label: string): Record<string, unknown> {
  const parsed = content.trim().length === 0 ? {} : parseYaml(content);
  if (parsed === null || parsed === undefined) {
    return {};
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a YAML mapping`);
  }

  return parsed as Record<string, unknown>;
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function shellQuoteIfNeeded(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}
