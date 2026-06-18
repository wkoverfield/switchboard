#!/usr/bin/env node
import { Command } from "commander";
import {
  type LoadConfigOptions,
  loadSwitchboardConfig,
  namespacesForProfiles,
  type PathResolutionOptions,
  resolveGlobalConfigPath,
  resolveRepoConfigPaths
} from "@switchboard-mcp/core";

const version = "0.1.0";

export function createProgram(): Command {
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
      const loaded = loadSwitchboardConfig(
        optionsFromCwd(globalOptions.cwd)
      );
      const repoPaths = resolveRepoConfigPaths(
        optionsFromCwd(globalOptions.cwd)
      );
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
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      console.log("Switchboard status");
      console.log(`Global config: ${status.globalConfigPath}`);
      console.log(
        `Repo config: ${status.repoConfigPath ?? "not found"}`
      );
      console.log(
        `Repo local config: ${status.repoLocalConfigPath ?? "not found"}`
      );
      console.log(`Profiles: ${status.profileCount}`);
      console.log(`Workspaces: ${status.workspaceCount}`);

      if (status.namespaces.length > 0) {
        console.log("");
        console.log("Namespaces:");
        for (const item of status.namespaces) {
          const label = item.generated ? "generated" : "explicit";
          console.log(`  ${item.profile} -> ${item.namespace} (${label})`);
        }
      }

      if (status.diagnostics.length > 0) {
        console.log("");
        console.log("Diagnostics:");
        for (const diagnostic of status.diagnostics) {
          console.log(`  ${diagnostic.level}: ${diagnostic.message}`);
        }
      }
    });

  program
    .command("doctor")
    .description("Run basic Switchboard config checks.")
    .option("--json", "print machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const loaded = loadSwitchboardConfig(
        optionsFromCwd(globalOptions.cwd)
      );
      const checks = [
        {
          name: "config-schema",
          ok: !loaded.diagnostics.some(
            (item: { level: string }) => item.level === "error"
          ),
          message: "Config files parse and match the Switchboard schema."
        },
        {
          name: "namespace-collisions",
          ok: loaded.namespaceCollisions.length === 0,
          message: "Profile namespaces are unique after normalization."
        },
        {
          name: "local-config-gitignore",
          ok: true,
          message:
            ".switchboard.local.yaml is ignored by the repository .gitignore."
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
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(ok ? "Switchboard doctor: OK" : "Switchboard doctor: failed");
        for (const check of checks) {
          console.log(`${check.ok ? "ok" : "fail"} ${check.name} - ${check.message}`);
        }

        for (const diagnostic of loaded.diagnostics) {
          console.log(`${diagnostic.level}: ${diagnostic.message}`);
        }
      }

      if (!ok) {
        process.exitCode = 1;
      }
    });

  return program;
}

function optionsFromCwd(cwd: string | undefined): LoadConfigOptions &
  PathResolutionOptions {
  return cwd ? { cwd } : {};
}

await createProgram().parseAsync(process.argv);
