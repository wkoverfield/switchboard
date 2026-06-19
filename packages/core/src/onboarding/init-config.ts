import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { PathResolutionOptions } from "../config/paths.js";
import { switchboardConfigSchema } from "../schemas/config.js";

export interface InitConfigOptions extends PathResolutionOptions {
  profileName?: string;
  command?: string;
}

export interface InitConfigPlan {
  path: string;
  exists: boolean;
  content: string;
}

export interface InitConfigValidationResult {
  ok: boolean;
  errors: string[];
}

const defaultProfileName = "local_example";
const defaultCommand = "node";
export const starterUpstreamArgPlaceholder = "./path/to/your-mcp-server.mjs";

export function createInitConfigPlan(
  options: InitConfigOptions = {}
): InitConfigPlan {
  const cwd = resolve(options.cwd ?? process.cwd());
  const profileName = options.profileName ?? defaultProfileName;
  const command = options.command ?? defaultCommand;
  const path = join(cwd, ".switchboard.yaml");

  return {
    path,
    exists: existsSync(path),
    content: renderStarterConfig({ profileName, command })
  };
}

export function renderStarterConfig(
  options: Pick<Required<InitConfigOptions>, "profileName" | "command">
): string {
  const config = starterConfigObject(options);
  const parsed = switchboardConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("\n"));
  }

  return stringifyYaml(config, { lineWidth: 0 });
}

export function validateInitConfigOptions(
  options: Pick<Required<InitConfigOptions>, "profileName" | "command">
): InitConfigValidationResult {
  const errors: string[] = [];
  if (options.command.trim().length === 0) {
    errors.push("command must not be empty");
  }

  if (containsControlCharacter(options.command)) {
    errors.push("command must not contain control characters");
  }

  const config = starterConfigObject(options);
  const parsed = switchboardConfigSchema.safeParse(config);
  if (parsed.success && errors.length === 0) {
    return { ok: true, errors: [] };
  }

  return {
    ok: false,
    errors: [
      ...errors,
      ...(parsed.success
        ? []
        : parsed.error.issues.map((issue) => issue.message))
    ]
  };
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
}

function starterConfigObject(
  options: Pick<Required<InitConfigOptions>, "profileName" | "command">
): Record<string, unknown> {
  return {
    version: 1,
    defaults: {
      defaultEnvironment: "local"
    },
    profiles: {
      [options.profileName]: {
        provider: "generic",
        environment: "local",
        namespace: options.profileName,
        readOnly: true,
        description: "Example generic stdio MCP server profile.",
        upstream: {
          type: "stdio",
          command: options.command,
          args: [starterUpstreamArgPlaceholder]
        }
      }
    },
    workspaces: {
      default: {
        paths: ["."],
        profiles: [options.profileName],
        defaultEnvironment: "local"
      }
    }
  };
}
