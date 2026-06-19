import { Command } from "commander";
import { dirname, resolve } from "node:path";
import {
  checkLocalConfigIgnored,
  type LoadConfigOptions,
  loadSwitchboardConfig,
  namespacesForProfiles,
  type PathResolutionOptions,
  resolveGlobalConfigPath,
  resolveRepoConfigPaths
} from "@switchboard-mcp/core";
import {
  GenericMcpRouter,
  profileConfigToStdioUpstream,
  serveSwitchboardMcpStdio,
  testStdioUpstreamProfile,
  type StdioProfileTestOptions,
  type StdioProfileTestResult,
  type StdioUpstreamProfile
} from "@switchboard-mcp/mcp-runtime";

const version = "0.1.0";

export interface ProgramIo {
  writeOut?: (message: string) => void;
  writeErr?: (message: string) => void;
  serveMcp?: (profiles: StdioUpstreamProfile[]) => Promise<void>;
  testProfile?: (
    profile: StdioUpstreamProfile,
    options?: StdioProfileTestOptions
  ) => Promise<StdioProfileTestResult>;
}

export function createProgram(io: ProgramIo = {}): Command {
  const writeOut = io.writeOut ?? ((message: string) => console.log(message));
  const writeErr = io.writeErr ?? ((message: string) => console.error(message));
  const serveMcp = io.serveMcp ?? serveProfilesOverStdio;
  const testProfile = io.testProfile ?? testStdioUpstreamProfile;
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

  program
    .command("serve")
    .description("Serve configured stdio MCP upstreams through one Switchboard MCP endpoint.")
    .action(async () => {
      const globalOptions = program.opts<{ cwd?: string }>();
      const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));

      if (!validateLoadedConfigForCommand(loaded, writeErr)) {
        return;
      }

      const profiles = stdioProfilesFromConfig(
        loaded.config.profiles,
        configCwdBase(loaded, globalOptions.cwd)
      );
      if (profiles.length === 0) {
        writeErr("error: no stdio upstream profiles are configured");
        process.exitCode = 1;
        return;
      }

      await serveMcp(profiles);
    });

  program
    .command("test <profile>")
    .description("Test one configured stdio MCP profile by listing its tools.")
    .option("--json", "print machine-readable JSON")
    .option("--timeout-ms <ms>", "MCP request timeout in milliseconds", "5000")
    .action(
      async (
        profileName: string,
        options: { json?: boolean; timeoutMs: string }
      ) => {
        const globalOptions = program.opts<{ cwd?: string }>();
        const loaded = loadSwitchboardConfig(optionsFromCwd(globalOptions.cwd));
        const timeoutMs = parseTimeoutMs(options.timeoutMs);

        if (timeoutMs === undefined) {
          writeErr("error: --timeout-ms must be a positive integer");
          process.exitCode = 1;
          return;
        }

        if (!validateLoadedConfigForCommand(loaded, writeErr)) {
          return;
        }

        const profile = loaded.config.profiles[profileName];
        if (!profile) {
          writeErr(`error: profile "${profileName}" was not found`);
          process.exitCode = 1;
          return;
        }

        const upstream = profileConfigToStdioUpstream(profileName, profile, {
          cwdBase: configCwdBase(loaded, globalOptions.cwd)
        });
        if (!upstream) {
          writeErr(
            `error: profile "${profileName}" does not define a stdio upstream`
          );
          process.exitCode = 1;
          return;
        }

        try {
          const result = await testProfile(upstream, { timeoutMs });
          if (options.json) {
            writeOut(JSON.stringify(result, null, 2));
          } else {
            writeOut(formatProfileTest(result));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (options.json) {
            writeOut(
              JSON.stringify(
                {
                  ok: false,
                  profileName,
                  error: message
                },
                null,
                2
              )
            );
          } else {
            writeErr(`error: ${message}`);
          }
          process.exitCode = 1;
        }
      }
    );

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

function formatProfileTest(result: StdioProfileTestResult): string {
  const lines = [
    `Switchboard profile test: ${result.ok ? "OK" : "failed"}`,
    `Profile: ${result.profileName}`,
    `Namespace: ${result.namespace}`,
    `Tools: ${result.toolCount}`
  ];

  if (result.tools.length > 0) {
    lines.push("", "Tool names:");
    for (const tool of result.tools) {
      lines.push(`  ${tool.name}`);
    }
  }

  return lines.join("\n");
}

function optionsFromCwd(cwd: string | undefined): LoadConfigOptions &
  PathResolutionOptions {
  return cwd ? { cwd } : {};
}

function validateLoadedConfigForCommand(
  loaded: ReturnType<typeof loadSwitchboardConfig>,
  writeErr: (message: string) => void
): boolean {
  if (loaded.namespaceCollisions.length > 0) {
    for (const collision of loaded.namespaceCollisions) {
      writeErr(
        `error: namespace "${collision.namespace}" is used by profiles: ${collision.profiles.join(", ")}`
      );
    }
    process.exitCode = 1;
    return false;
  }

  const blockingDiagnostics = loaded.diagnostics.filter(
    (diagnostic) => diagnostic.level === "error"
  );
  if (blockingDiagnostics.length > 0) {
    for (const diagnostic of blockingDiagnostics) {
      writeErr(`error: ${diagnostic.message}`);
    }
    process.exitCode = 1;
    return false;
  }

  return true;
}

function parseTimeoutMs(value: string): number | undefined {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function stdioProfilesFromConfig(
  profiles: ReturnType<typeof loadSwitchboardConfig>["config"]["profiles"],
  cwdBase: string
): StdioUpstreamProfile[] {
  return Object.entries(profiles).flatMap(([profileName, profile]) => {
    const upstream = profileConfigToStdioUpstream(profileName, profile, {
      cwdBase
    });
    return upstream ? [upstream] : [];
  });
}

async function serveProfilesOverStdio(
  profiles: StdioUpstreamProfile[]
): Promise<void> {
  const router = new GenericMcpRouter(profiles);
  await serveSwitchboardMcpStdio(router);
}

function configCwdBase(
  loaded: ReturnType<typeof loadSwitchboardConfig>,
  cwd: string | undefined
): string {
  const repoSource = loaded.sources.find(
    (source) => source.kind === "repo" && source.loaded && source.path
  );

  if (repoSource?.path) {
    return dirname(repoSource.path);
  }

  return cwd ? resolve(cwd) : process.cwd();
}
