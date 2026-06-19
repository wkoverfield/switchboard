import { Command } from "commander";
import {
  checkLocalConfigIgnored,
  type LoadConfigOptions,
  loadSwitchboardConfig,
  namespacesForProfiles,
  type PathResolutionOptions,
  resolveGlobalConfigPath,
  resolveRepoConfigPaths
} from "@switchboard-mcp/core";

const version = "0.1.0";

export interface ProgramIo {
  writeOut?: (message: string) => void;
}

export function createProgram(io: ProgramIo = {}): Command {
  const writeOut = io.writeOut ?? ((message: string) => console.log(message));
  const program = new Command();

  program
    .name("switchboard")
    .description(
      "Local-first MCP profile router for multiple accounts, projects, environments, and AI coding agents."
    )
    .version(version)
    .option("--cwd <path>", "resolve repo config from this directory");

  program
    .command("status")
    .description("Show active Switchboard config sources and profiles.")
    .option("--json", "print machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const configOptions = optionsFromCwd(globalOptions.cwd);
      const loaded = loadSwitchboardConfig(configOptions);
      const repoPaths = resolveRepoConfigPaths(configOptions);
      const status = {
        globalConfigPath: resolveGlobalConfigPath(),
        repoConfigPath: repoPaths.repoConfigPath ?? null,
        repoLocalConfigPath: repoPaths.repoLocalConfigPath ?? null,
        sources: loaded.sources,
        profileCount: Object.keys(loaded.config.profiles).length,
        workspaceCount: Object.keys(loaded.config.workspaces).length,
        namespaces: namespacesForProfiles(loaded.config.profiles),
        diagnostics: loaded.diagnostics
      };

      if (options.json) {
        writeOut(JSON.stringify(status, null, 2));
        return;
      }

      writeOut(formatStatus(status));
    });

  program
    .command("doctor")
    .description("Run basic Switchboard config checks.")
    .option("--json", "print machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const configOptions = optionsFromCwd(globalOptions.cwd);
      const loaded = loadSwitchboardConfig(configOptions);
      const localIgnore = checkLocalConfigIgnored(globalOptions.cwd);
      const checks = [
        {
          name: "config-schema",
          ok: !loaded.diagnostics.some((item) => item.level === "error"),
          message: "Config files parse and match the Switchboard schema."
        },
        {
          name: "namespace-collisions",
          ok: loaded.namespaceCollisions.length === 0,
          message: "Profile namespaces are unique after normalization."
        },
        {
          name: "local-config-gitignore",
          ok: localIgnore.ok,
          message: localIgnore.message
        }
      ];

      const ok = checks.every((check) => check.ok);
      const result = {
        ok,
        checks,
        diagnostics: loaded.diagnostics,
        namespaceCollisions: loaded.namespaceCollisions
      };

      if (options.json) {
        writeOut(JSON.stringify(result, null, 2));
      } else {
        writeOut(formatDoctor(result));
      }

      if (!ok) {
        process.exitCode = 1;
      }
    });

  return program;
}

function formatStatus(status: {
  globalConfigPath: string;
  repoConfigPath: string | null;
  repoLocalConfigPath: string | null;
  profileCount: number;
  workspaceCount: number;
  namespaces: Array<{ profile: string; namespace: string; generated: boolean }>;
  diagnostics: Array<{ level: string; message: string }>;
}): string {
  const lines = [
    "Switchboard status",
    `Global config: ${status.globalConfigPath}`,
    `Repo config: ${status.repoConfigPath ?? "not found"}`,
    `Repo local config: ${status.repoLocalConfigPath ?? "not found"}`,
    `Profiles: ${status.profileCount}`,
    `Workspaces: ${status.workspaceCount}`
  ];

  if (status.namespaces.length > 0) {
    lines.push("", "Namespaces:");
    for (const item of status.namespaces) {
      const label = item.generated ? "generated" : "explicit";
      lines.push(`  ${item.profile} -> ${item.namespace} (${label})`);
    }
  }

  if (status.diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    for (const diagnostic of status.diagnostics) {
      lines.push(`  ${diagnostic.level}: ${diagnostic.message}`);
    }
  }

  return lines.join("\n");
}

function formatDoctor(result: {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; message: string }>;
  diagnostics: Array<{ level: string; message: string }>;
}): string {
  const lines = [
    result.ok ? "Switchboard doctor: OK" : "Switchboard doctor: failed"
  ];

  for (const check of result.checks) {
    lines.push(`${check.ok ? "ok" : "fail"} ${check.name} - ${check.message}`);
  }

  for (const diagnostic of result.diagnostics) {
    lines.push(`${diagnostic.level}: ${diagnostic.message}`);
  }

  return lines.join("\n");
}

function optionsFromCwd(cwd: string | undefined): LoadConfigOptions &
  PathResolutionOptions {
  return cwd ? { cwd } : {};
}
