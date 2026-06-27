import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { detectNamespaceCollisions } from "../namespaces/namespaces.js";
import {
  type SwitchboardConfig,
  switchboardConfigSchema
} from "../schemas/config.js";
import {
  type PathResolutionOptions,
  resolveGlobalConfigPath,
  resolveRepoConfigPaths
} from "./paths.js";

export type ConfigSourceKind =
  | "built-in"
  | "global"
  | "repo"
  | "repo-local"
  | "environment"
  | "cli";

export interface ConfigSource {
  kind: ConfigSourceKind;
  path?: string;
  loaded: boolean;
}

export interface ConfigDiagnostic {
  level: "error" | "warning" | "info";
  message: string;
  source?: ConfigSourceKind;
  path?: string;
}

export interface LoadConfigOptions extends PathResolutionOptions {
  cliOverrides?: Record<string, unknown>;
}

export interface LoadedConfig {
  config: SwitchboardConfig;
  sources: ConfigSource[];
  diagnostics: ConfigDiagnostic[];
  namespaceCollisions: ReturnType<typeof detectNamespaceCollisions>;
}

const builtInConfig: SwitchboardConfig = {
  version: 1,
  defaults: {
    auditLog: true,
    confirmDestructive: true,
    hideDisabledProfiles: true,
    toolNameFormat: "{namespace}_{tool}"
  },
  profiles: {},
  workspaces: {},
  policies: {},
  acceptedRisks: { directMcp: [] }
};

export function loadSwitchboardConfig(
  options: LoadConfigOptions = {}
): LoadedConfig {
  const env = options.env ?? process.env;
  const diagnostics: ConfigDiagnostic[] = [];
  const sources: ConfigSource[] = [{ kind: "built-in", loaded: true }];
  const rawConfigs: Record<string, unknown>[] = [builtInConfig];
  const globalPath = resolveGlobalConfigPath(options);
  const repoPaths = resolveRepoConfigPaths(options);

  pushFileConfig("global", globalPath);
  if (repoPaths.repoConfigPath) {
    pushFileConfig("repo", repoPaths.repoConfigPath);
  } else {
    sources.push({ kind: "repo", loaded: false });
  }

  if (repoPaths.repoLocalConfigPath) {
    pushFileConfig("repo-local", repoPaths.repoLocalConfigPath);
  } else {
    sources.push({ kind: "repo-local", loaded: false });
  }

  const envConfig = configFromEnvironment(env);
  sources.push({ kind: "environment", loaded: Object.keys(envConfig).length > 0 });
  rawConfigs.push(envConfig);

  const cliConfig = options.cliOverrides ?? {};
  sources.push({ kind: "cli", loaded: Object.keys(cliConfig).length > 0 });
  rawConfigs.push(cliConfig);

  const merged = rawConfigs.reduce<Record<string, unknown>>(
    (current, next) => deepMerge(current, next),
    {}
  );

  const parsed = switchboardConfigSchema.safeParse(merged);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      diagnostics.push({
        level: "error",
        message: `${issue.path.join(".") || "config"}: ${issue.message}`
      });
    }

    return {
      config: builtInConfig,
      sources,
      diagnostics,
      namespaceCollisions: []
    };
  }

  const namespaceCollisions = detectNamespaceCollisions(parsed.data.profiles);
  for (const collision of namespaceCollisions) {
    diagnostics.push({
      level: "error",
      message: `Namespace "${collision.namespace}" is used by profiles: ${collision.profiles.join(", ")}`
    });
  }

  return {
    config: parsed.data,
    sources,
    diagnostics,
    namespaceCollisions
  };

  function pushFileConfig(kind: ConfigSourceKind, path: string): void {
    if (!existsSync(path)) {
      sources.push({ kind, path, loaded: false });
      return;
    }

    try {
      const raw = readFileSync(path, "utf8");
      const parsedYaml = raw.trim().length === 0 ? {} : parseYaml(raw);
      rawConfigs.push(asConfigObject(parsedYaml, path, kind, diagnostics));
      sources.push({ kind, path, loaded: true });
    } catch (error) {
      diagnostics.push({
        level: "error",
        source: kind,
        path,
        message: error instanceof Error ? error.message : String(error)
      });
      sources.push({ kind, path, loaded: false });
    }
  }
}

export function configFromEnvironment(
  env: NodeJS.ProcessEnv
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  if (env.SWITCHBOARD_DEFAULT_ENVIRONMENT) {
    defaults.defaultEnvironment = env.SWITCHBOARD_DEFAULT_ENVIRONMENT;
  }
  if (env.SWITCHBOARD_ACTIVE_PROFILE) {
    defaults.activeProfile = env.SWITCHBOARD_ACTIVE_PROFILE;
  }

  return Object.keys(defaults).length > 0 ? { defaults } : {};
}

export function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(value)) {
      result[key] = deepMerge(baseValue, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function asConfigObject(
  value: unknown,
  path: string,
  kind: ConfigSourceKind,
  diagnostics: ConfigDiagnostic[]
): Record<string, unknown> {
  if (value === null || value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    diagnostics.push({
      level: "error",
      source: kind,
      path,
      message: "Config root must be a YAML mapping."
    });
    return {};
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}
