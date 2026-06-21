import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createApprovalRequest, markApprovalRequestStale } from "@switchboard-mcp/core";
import { createProgram } from "./program.js";

const fixtureServerPath = fileURLToPath(
  new URL(
    "../../../packages/mcp-runtime/fixtures/echo-server.mjs",
    import.meta.url
  )
);

describe("switchboard CLI program", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("prints status JSON for a repo config resolved with --cwd", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  supabase_findu_dev:",
        "    provider: supabase",
        "    environment: development"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "status", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      profileCount: number;
      namespaces: Array<{ namespace: string }>;
    };
    expect(parsed.profileCount).toBe(1);
    expect(parsed.namespaces[0]?.namespace).toBe("supabase_findu_dev");
  });

  it("returns a failing doctor result for invalid config", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      ["version: 1", "profiles:", "  broken:", "    namespace: '!!!'"].join(
        "\n"
      )
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      diagnostics: Array<{ message: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics[0]?.message).toContain("provider");
    expect(process.exitCode).toBe(1);
  });

  it("fails doctor when .switchboard.local.yaml is not ignored", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), "node_modules/\n");
    writeFileSync(join(root, ".switchboard.local.yaml"), "version: 1\n");

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      checks: Array<{ name: string; ok: boolean }>;
    };
    expect(parsed.ok).toBe(false);
    expect(
      parsed.checks.find((check) => check.name === "local-config-gitignore")?.ok
    ).toBe(false);
  });

  it("passes doctor local-config hygiene for ephemeral repos without local config", async () => {
    const root = makeTempProject();

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      checks: Array<{ name: string; ok: boolean; message: string }>;
      nextSteps: string[];
    };
    expect(parsed.ok).toBe(true);
    expect(
      parsed.checks.find((check) => check.name === "local-config-gitignore")
    ).toMatchObject({
      ok: true,
      message:
        "No .switchboard.local.yaml found. Add it to .gitignore before storing local overrides."
    });
    expect(parsed.nextSteps).not.toContain(
      'add ".switchboard.local.yaml" to .gitignore'
    );
  });

  it("fails doctor on namespace collisions", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  stripe-live:",
        "    provider: stripe",
        "  stripe_live:",
        "    provider: stripe"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      namespaceCollisions: Array<{ namespace: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.namespaceCollisions[0]?.namespace).toBe("stripe_live");
  });

  it("prints doctor next steps for an uninitialized repo", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      nextSteps: string[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.nextSteps).toContain("switchboard init --write");
  });

  it("prints doctor next steps for a ready stdio profile", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      nextSteps: string[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.nextSteps).toEqual([
      "switchboard test local_echo",
      "switchboard install codex --write",
      "switchboard install claude --write"
    ]);
  });

  it("reports installed project client configs in doctor JSON", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);

    await createProgram().parseAsync(
      ["--cwd", root, "install", "codex", "--write"],
      {
        from: "user"
      }
    );
    await createProgram().parseAsync(
      ["--cwd", root, "install", "claude", "--write"],
      {
        from: "user"
      }
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      clientConfigs: Array<{ client: string; status: string }>;
      nextSteps: string[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.clientConfigs).toEqual([
      expect.objectContaining({ client: "codex", status: "installed" }),
      expect.objectContaining({ client: "claude", status: "installed" })
    ]);
    expect(parsed.nextSteps).toEqual(["switchboard test local_echo"]);
  });

  it("reports stale project client configs in doctor JSON", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);
    mkdirSync(join(root, ".codex"));
    writeFileSync(
      join(root, ".codex", "config.toml"),
      [
        "[mcp_servers.switchboard]",
        'command = "switchboard"',
        'args = ["serve"]'
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      clientConfigs: Array<{ client: string; status: string }>;
      nextSteps: string[];
    };
    expect(parsed.clientConfigs[0]).toMatchObject({
      client: "codex",
      status: "stale"
    });
    expect(parsed.nextSteps).toContain("switchboard install codex --write");
  });

  it("prints other project MCP server names in human doctor output", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          linear: {
            command: "linear-mcp"
          }
        }
      })
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "doctor"], {
      from: "user"
    });

    expect(output.join("\n")).toContain("other MCP servers: linear");
  });

  it("prints init dry-run JSON without writing config", async () => {
    const root = makeTempProject();

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(
      ["--cwd", root, "init", "--json", "--profile-name", "repo_tools"],
      {
        from: "user"
      }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      path: string;
      written: boolean;
      content: string;
    };
    expect(parsed.path).toBe(join(root, ".switchboard.yaml"));
    expect(parsed.written).toBe(false);
    expect(parsed.content).toContain("repo_tools:");
    expect(existsSync(join(root, ".switchboard.yaml"))).toBe(false);
  });

  it("prints daemon not-running status JSON", async () => {
    const root = makeTempProject();

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(
      ["daemon", "status", "--runtime-dir", root, "--json"],
      {
        from: "user"
      }
    );

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      state: "not-running",
      paths: {
        runtimeDir: root,
        socketPath: join(root, "daemon.sock"),
        statePath: join(root, "daemon.json")
      }
    });
  });

  it("cleans stale daemon state on stop", async () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, "daemon.json"),
      JSON.stringify({
        version: 1,
        pid: 99999999,
        startedAt: "2026-06-19T15:00:00.000Z",
        socketPath: join(root, "daemon.sock")
      })
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["daemon", "stop", "--runtime-dir", root, "--json"], {
      from: "user"
    });

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: true,
      status: {
        state: "not-running"
      },
      message: "Removed stale Switchboard daemon state."
    });
    expect(existsSync(join(root, "daemon.json"))).toBe(false);
  });

  it("does not trust daemon status without a heartbeat", async () => {
    const root = makeTempProject();
    writeFileSync(
      join(root, "daemon.json"),
      JSON.stringify({
        version: 1,
        pid: process.pid,
        startedAt: "2026-06-19T15:00:00.000Z",
        socketPath: join(root, "daemon.sock")
      })
    );
    writeFileSync(join(root, "daemon.sock"), "");

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(
      ["daemon", "status", "--runtime-dir", root, "--json"],
      {
        from: "user"
      }
    );

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      state: "stale",
      daemon: {
        pid: process.pid
      }
    });
  });

  it("fails daemon ping when the daemon is not running", async () => {
    const root = makeTempProject();

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["daemon", "ping", "--runtime-dir", root, "--json"], {
      from: "user"
    });

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      error: "Switchboard daemon is not running.",
      status: {
        state: "not-running"
      }
    });
    expect(process.exitCode).toBe(1);
  });

  it("fails daemon tools when the daemon is not running", async () => {
    const root = makeTempProject();

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["daemon", "tools", "--runtime-dir", root, "--json"], {
      from: "user"
    });

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      error: "Switchboard daemon is not running.",
      status: {
        state: "not-running"
      }
    });
    expect(process.exitCode).toBe(1);
  });

  it("fails daemon-backed mcp without auto-start when the daemon is not running", async () => {
    const root = makeTempProject();

    const errors: string[] = [];
    const program = createProgram({ writeErr: (message) => errors.push(message) });
    await program.parseAsync(["mcp", "--runtime-dir", root, "--no-auto-start"], {
      from: "user"
    });

    expect(errors).toEqual([
      "error: Switchboard daemon is not running; run switchboard daemon start first"
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("auto-starts the daemon for daemon-backed mcp", async () => {
    const root = makeTempProject();
    const socketPath = join(root, "daemon.sock");
    const servedSockets: string[] = [];
    const startOptions: unknown[] = [];
    const program = createProgram({
      daemonStatus: async () => ({
        state: "not-running",
        paths: {
          runtimeDir: root,
          socketPath,
          statePath: join(root, "daemon.json")
        }
      }),
      startDaemon: async (options) => {
        startOptions.push(options);
        return {
          ok: true,
          message: "Switchboard daemon started.",
          status: {
            state: "running",
            paths: {
              runtimeDir: root,
              socketPath,
              statePath: join(root, "daemon.json")
            },
            daemon: {
              version: 1,
              pid: process.pid,
              startedAt: "2026-06-19T16:00:00.000Z",
              socketPath,
              cwd: root
            }
          }
        };
      },
      serveDaemonMcp: async (socket) => {
        servedSockets.push(socket);
      }
    });

    await program.parseAsync(["--cwd", root, "mcp", "--runtime-dir", root], {
      from: "user"
    });

    expect(startOptions).toEqual([{ runtimeDir: root, cwd: root }]);
    expect(servedSockets).toEqual([socketPath]);
    expect(process.exitCode).toBeUndefined();
  });

  it("passes active mandate context to daemon-backed mcp", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const mandateStorePath = join(root, "state", "mandates.json");
    const socketPath = join(root, "daemon.sock");
    const served: Array<{
      socket: string;
      mandateId: string | undefined;
      approvalWaitMs: number | undefined;
    }> = [];
    const program = createProgram({
      mandateStorePath,
      writeOut: () => undefined,
      daemonStatus: async () => ({
        state: "running",
        paths: {
          runtimeDir: root,
          socketPath,
          statePath: join(root, "daemon.json")
        },
        daemon: {
          version: 1,
          pid: process.pid,
          startedAt: "2026-06-20T08:00:00.000Z",
          socketPath,
          cwd: root
        }
      }),
      serveDaemonMcp: async (socket, options) => {
        served.push({
          socket,
          mandateId: options?.mandateId,
          approvalWaitMs: options?.approvalWaitMs
        });
      }
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "implementer",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--allow-tool",
        "github_findu_*",
        "--deny-tool",
        "*_deploy_prod",
        "--require-approval-tool",
        "github_findu_checks_rerun",
        "--require-approval-reason",
        "rerunning CI changes remote state",
        "--require-approval-risk",
        "high",
        "--require-approval-label",
        "remote-state",
        "--require-approval-label",
        "ci",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "mcp", "--mandate", "fix-ci", "--approval-wait", "30s"],
      { from: "user" }
    );

    expect(served).toEqual([
      { socket: socketPath, mandateId: "fix-ci", approvalWaitMs: 30_000 }
    ]);
  });

  it("rejects invalid daemon-backed mcp approval wait durations", async () => {
    const root = makeTempProject();
    const socketPath = join(root, "daemon.sock");
    const errors: string[] = [];
    const served: string[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message),
      daemonStatus: async () => ({
        state: "running",
        paths: {
          runtimeDir: root,
          socketPath,
          statePath: join(root, "daemon.json")
        },
        daemon: {
          version: 1,
          pid: process.pid,
          startedAt: "2026-06-20T08:00:00.000Z",
          socketPath,
          cwd: root
        }
      }),
      serveDaemonMcp: async (socket) => {
        served.push(socket);
      }
    });

    await program.parseAsync(["--cwd", root, "mcp", "--approval-wait", "11m"], {
      from: "user"
    });

    expect(errors).toEqual(["error: --approval-wait must be 10m or less"]);
    expect(served).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it("fails daemon-backed mcp for a missing mandate", async () => {
    const root = makeTempProject();
    const socketPath = join(root, "daemon.sock");
    const errors: string[] = [];
    const served: string[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message),
      mandateStorePath: join(root, "state", "mandates.json"),
      daemonStatus: async () => ({
        state: "running",
        paths: {
          runtimeDir: root,
          socketPath,
          statePath: join(root, "daemon.json")
        },
        daemon: {
          version: 1,
          pid: process.pid,
          startedAt: "2026-06-20T08:00:00.000Z",
          socketPath,
          cwd: root
        }
      }),
      serveDaemonMcp: async (socket) => {
        served.push(socket);
      }
    });

    await program.parseAsync(["--cwd", root, "mcp", "--mandate", "missing"], {
      from: "user"
    });

    expect(errors).toEqual([
      `error: mandate "missing" was not found for ${root}`
    ]);
    expect(served).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it("refuses daemon-backed mcp when the running daemon uses another cwd", async () => {
    const root = makeTempProject();
    const otherRoot = makeTempProject();
    const errors: string[] = [];
    const servedSockets: string[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message),
      daemonStatus: async () => ({
        state: "running",
        paths: {
          runtimeDir: root,
          socketPath: join(root, "daemon.sock"),
          statePath: join(root, "daemon.json")
        },
        daemon: {
          version: 1,
          pid: process.pid,
          startedAt: "2026-06-19T16:00:00.000Z",
          socketPath: join(root, "daemon.sock"),
          cwd: otherRoot
        }
      }),
      serveDaemonMcp: async (socket) => {
        servedSockets.push(socket);
      }
    });

    await program.parseAsync(["--cwd", root, "mcp", "--runtime-dir", root], {
      from: "user"
    });

    expect(errors).toEqual([
      `error: Switchboard daemon is running for ${otherRoot}; stop it or use --runtime-dir for a separate daemon before serving ${root}`
    ]);
    expect(servedSockets).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it("fails daemon-backed mcp when auto-start fails", async () => {
    const root = makeTempProject();
    const errors: string[] = [];
    const servedSockets: string[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message),
      daemonStatus: async () => ({
        state: "not-running",
        paths: {
          runtimeDir: root,
          socketPath: join(root, "daemon.sock"),
          statePath: join(root, "daemon.json")
        }
      }),
      startDaemon: async () => ({
        ok: false,
        message: "Switchboard daemon did not start.",
        status: {
          state: "not-running",
          paths: {
            runtimeDir: root,
            socketPath: join(root, "daemon.sock"),
            statePath: join(root, "daemon.json")
          }
        }
      }),
      serveDaemonMcp: async (socket) => {
        servedSockets.push(socket);
      }
    });

    await program.parseAsync(["mcp", "--runtime-dir", root], {
      from: "user"
    });

    expect(errors).toEqual(["error: Switchboard daemon did not start."]);
    expect(servedSockets).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it("writes init config and refuses accidental overwrite", async () => {
    const root = makeTempProject();
    const output: string[] = [];
    const errors: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      writeErr: (message) => errors.push(message)
    });

    await program.parseAsync(["--cwd", root, "init", "--write", "--json"], {
      from: "user"
    });

    const configPath = join(root, ".switchboard.yaml");
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      path: configPath,
      written: true,
      overwritten: false
    });
    expect(readFileSync(configPath, "utf8")).toContain("local_example:");

    await program.parseAsync(["--cwd", root, "init", "--write"], {
      from: "user"
    });

    expect(errors).toEqual([
      `error: ${configPath} already exists; use --force to overwrite`
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("doctor treats freshly initialized placeholder profiles as not ready", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "init", "--write", "--json"], {
      from: "user"
    });

    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[1] ?? "{}") as {
      ok: boolean;
      nextSteps: string[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.nextSteps).toContain(
      "edit .switchboard.yaml and replace the starter upstream args"
    );
    expect(parsed.nextSteps).not.toContain("switchboard install codex");
    expect(parsed.nextSteps).not.toContain("switchboard install claude");
  });

  it("fails init for invalid starter config options", async () => {
    const root = makeTempProject();

    const errors: string[] = [];
    const program = createProgram({ writeErr: (message) => errors.push(message) });
    await program.parseAsync(
      ["--cwd", root, "init", "--profile-name", "!!!", "--command", "node\nbad"],
      {
        from: "user"
      }
    );

    expect(errors.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
    expect(existsSync(join(root, ".switchboard.yaml"))).toBe(false);
  });

  it("fails serve when no stdio upstream profiles are configured", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  generic_http:",
        "    provider: generic",
        "    upstream:",
        "      type: http",
        "      url: http://localhost:3000/mcp"
      ].join("\n")
    );

    const errors: string[] = [];
    const program = createProgram({ writeErr: (message) => errors.push(message) });
    await program.parseAsync(["--cwd", root, "serve"], {
      from: "user"
    });

    expect(errors).toEqual(["error: no stdio upstream profiles are configured"]);
    expect(process.exitCode).toBe(1);
  });

  it("fails serve on namespace collisions before starting MCP", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  alpha-tools:",
        "    provider: generic",
        "    upstream:",
        "      type: stdio",
        "      command: node",
        "  alpha_tools:",
        "    provider: generic",
        "    upstream:",
        "      type: stdio",
        "      command: node"
      ].join("\n")
    );

    const errors: string[] = [];
    const servedProfiles: unknown[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message),
      serveMcp: async (profiles) => {
        servedProfiles.push(...profiles);
      }
    });
    await program.parseAsync(["--cwd", root, "serve"], {
      from: "user"
    });

    expect(errors).toEqual([
      'error: namespace "alpha_tools" is used by profiles: alpha-tools, alpha_tools'
    ]);
    expect(servedProfiles).toEqual([]);
    expect(process.exitCode).toBe(1);
  });

  it("passes configured stdio upstream profiles to serve", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  local_echo:",
        "    provider: generic",
        "    namespace: echo_tools",
        "    upstream:",
        "      type: stdio",
        "      command: node",
        "      args:",
        "        - fixture.mjs"
      ].join("\n")
    );

    const servedProfiles: unknown[] = [];
    const program = createProgram({
      serveMcp: async (profiles) => {
        servedProfiles.push(...profiles);
      }
    });
    await program.parseAsync(["--cwd", root, "serve"], {
      from: "user"
    });

    expect(servedProfiles).toEqual([
      {
        profileName: "local_echo",
        namespace: "echo_tools",
        command: "node",
        args: ["fixture.mjs"],
        cwd: root
      }
    ]);
  });

  it("scopes daemonless serve profiles through an active mandate", async () => {
    const root = makeTempProject();
    const mandateStorePath = join(root, "state", "mandates.json");
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  github_findu:",
        "    provider: generic",
        "    namespace: github_findu",
        "    upstream:",
        "      type: stdio",
        "      command: node",
        "  vercel_preview:",
        "    provider: generic",
        "    namespace: vercel_preview",
        "    upstream:",
        "      type: stdio",
        "      command: node"
      ].join("\n")
    );

    const served: Array<{
      profiles: unknown[];
      mandateId: string | undefined;
      toolPolicy: unknown;
    }> = [];
    const program = createProgram({
      mandateStorePath,
      writeOut: () => undefined,
      serveMcp: async (profiles, options) => {
        served.push({
          profiles,
          mandateId: options?.mandateId,
          toolPolicy: options?.toolPolicy
        });
      }
    });
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "implementer",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--allow-tool",
        "github_findu_*",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(["--cwd", root, "serve", "--mandate", "fix-ci"], {
      from: "user"
    });

    expect(served).toEqual([
      {
        mandateId: "fix-ci",
        toolPolicy: {
          allowedTools: ["github_findu_*"],
          deniedTools: [],
          approvalGates: [],
          approvedApprovalRequests: []
        },
        profiles: [
          {
            profileName: "github_findu",
            namespace: "github_findu",
            command: "node",
            cwd: root
          }
        ]
      }
    ]);
  });

  it("lists mandate-scoped tools with approval metadata", async () => {
    const root = makeTempProject();
    const mandateStorePath = join(root, "state", "mandates.json");
    writeMandateFixtureConfig(root);

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath
    });
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "implementer",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--allow-tool",
        "github_findu_*",
        "--require-approval-tool",
        "github_findu_echo",
        "--require-approval-reason",
        "rerunning CI changes remote state",
        "--require-approval-risk",
        "high",
        "--require-approval-label",
        "ci",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "tools", "--mandate", "fix-ci", "--json"],
      { from: "user" }
    );

    const parsed = JSON.parse(output[1] ?? "{}") as {
      schemaVersion: string;
      ok: boolean;
      mandate: { id: string };
      profileCount: number;
      toolCount: number;
      approvalRequiredCount: number;
      tools: Array<{
        name: string;
        profileName: string;
        _meta?: {
          switchboard?: {
            approvalRequired?: {
              gateId: string;
              toolPattern: string;
              reason?: string;
              risk?: string;
              labels?: string[];
            };
          };
        };
      }>;
    };
    expect(parsed).toMatchObject({
      schemaVersion: "switchboard.tool-surface.v1",
      ok: true,
      mandate: { id: "fix-ci" },
      profileCount: 1,
      toolCount: 2,
      approvalRequiredCount: 1
    });
    expect(parsed.tools.map((tool) => tool.name).sort()).toEqual([
      "github_findu_echo",
      "github_findu_whoami"
    ]);
    expect(
      parsed.tools.find((tool) => tool.name === "github_findu_echo")
    ).toMatchObject({
      profileName: "github_findu",
      _meta: {
        switchboard: {
          approvalRequired: {
            gateId: "gate-1",
            toolPattern: "github_findu_echo",
            reason: "rerunning CI changes remote state",
            risk: "high",
            labels: ["ci"]
          }
        }
      }
    });
  });

  it("keeps denied and unallowed tools out of mandate tool discovery", async () => {
    const root = makeTempProject();
    const mandateStorePath = join(root, "state", "mandates.json");
    writeMandateFixtureConfig(root);

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath
    });
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "deny-echo",
        "--agent",
        "implementer",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--allow-tool",
        "github_findu_*",
        "--deny-tool",
        "github_findu_echo",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "tools", "--mandate", "deny-echo", "--json"],
      { from: "user" }
    );

    const denyParsed = JSON.parse(output.at(-1) ?? "{}") as {
      schemaVersion: string;
      toolCount: number;
      tools: Array<{ name: string }>;
    };
    expect(denyParsed.schemaVersion).toBe("switchboard.tool-surface.v1");
    expect(denyParsed.toolCount).toBe(1);
    expect(denyParsed.tools.map((tool) => tool.name)).toEqual([
      "github_findu_whoami"
    ]);

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "approval-not-allow",
        "--agent",
        "implementer",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--allow-tool",
        "github_findu_whoami",
        "--require-approval-tool",
        "github_findu_echo",
        "--require-approval-reason",
        "echo needs approval",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "tools", "--mandate", "approval-not-allow", "--json"],
      { from: "user" }
    );

    const approvalParsed = JSON.parse(output.at(-1) ?? "{}") as {
      schemaVersion: string;
      approvalRequiredCount: number;
      toolCount: number;
      tools: Array<{ name: string }>;
    };
    expect(approvalParsed.schemaVersion).toBe("switchboard.tool-surface.v1");
    expect(approvalParsed.toolCount).toBe(1);
    expect(approvalParsed.approvalRequiredCount).toBe(0);
    expect(approvalParsed.tools.map((tool) => tool.name)).toEqual([
      "github_findu_whoami"
    ]);
  });

  it("prints profile test JSON for a configured stdio upstream", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  local_echo:",
        "    provider: generic",
        "    namespace: echo_tools",
        "    upstream:",
        "      type: stdio",
        "      command: node",
        "      args:",
        "        - fixture.mjs"
      ].join("\n")
    );

    const output: string[] = [];
    const testedProfiles: unknown[] = [];
    const auditEntries: unknown[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      auditLogger: {
        async log(entry) {
          auditEntries.push(entry);
        }
      },
      testProfile: async (profile, options) => {
        testedProfiles.push({ profile, options });
        return {
          ok: true,
          profileName: profile.profileName,
          namespace: profile.namespace,
          toolCount: 2,
          tools: [{ name: "echo" }, { name: "whoami" }]
        };
      }
    });
    await program.parseAsync(
      ["--cwd", root, "test", "local_echo", "--json", "--timeout-ms", "1234"],
      {
        from: "user"
      }
    );

    expect(testedProfiles).toEqual([
      {
        profile: {
          profileName: "local_echo",
          namespace: "echo_tools",
          command: "node",
          args: ["fixture.mjs"],
          cwd: root
        },
        options: { timeoutMs: 1234 }
      }
    ]);
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: true,
      profileName: "local_echo",
      namespace: "echo_tools",
      toolCount: 2
    });
    expect(auditEntries).toMatchObject([
      {
        action: "profile_test",
        status: "ok",
        profileName: "local_echo",
        namespace: "echo_tools"
      }
    ]);
  });

  it("audits failed profile tests", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);

    const auditEntries: unknown[] = [];
    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      auditLogger: {
        async log(entry) {
          auditEntries.push(entry);
        }
      },
      testProfile: async () => {
        throw new Error("token=secret-value failed");
      }
    });
    await program.parseAsync(["--cwd", root, "test", "local_echo", "--json"], {
      from: "user"
    });

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      profileName: "local_echo",
      error: "token=secret-value failed"
    });
    expect(auditEntries).toMatchObject([
      {
        action: "profile_test",
        status: "error",
        profileName: "local_echo",
        namespace: "echo_tools",
        error: "token=secret-value failed"
      }
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("does not fail profile tests when audit logging fails", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      auditLogger: {
        async log() {
          throw new Error("audit unavailable");
        }
      },
      testProfile: async (profile) => ({
        ok: true,
        profileName: profile.profileName,
        namespace: profile.namespace,
        toolCount: 0,
        tools: []
      })
    });
    await program.parseAsync(["--cwd", root, "test", "local_echo", "--json"], {
      from: "user"
    });

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: true,
      profileName: "local_echo"
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("still reports profile test failures when audit logging also fails", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      auditLogger: {
        async log() {
          throw new Error("audit unavailable");
        }
      },
      testProfile: async () => {
        throw new Error("upstream failed");
      }
    });
    await program.parseAsync(["--cwd", root, "test", "local_echo", "--json"], {
      from: "user"
    });

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      profileName: "local_echo",
      error: "upstream failed"
    });
    expect(process.exitCode).toBe(1);
  });

  it("fails profile test when the profile does not exist", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(join(root, ".switchboard.yaml"), "version: 1\nprofiles: {}\n");

    const errors: string[] = [];
    const program = createProgram({ writeErr: (message) => errors.push(message) });
    await program.parseAsync(["--cwd", root, "test", "missing"], {
      from: "user"
    });

    expect(errors).toEqual(['error: profile "missing" was not found']);
    expect(process.exitCode).toBe(1);
  });

  it("fails profile test for non-stdio upstreams", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  generic_http:",
        "    provider: generic",
        "    upstream:",
        "      type: http",
        "      url: http://localhost:3000/mcp"
      ].join("\n")
    );

    const errors: string[] = [];
    const program = createProgram({ writeErr: (message) => errors.push(message) });
    await program.parseAsync(["--cwd", root, "test", "generic_http"], {
      from: "user"
    });

    expect(errors).toEqual([
      'error: profile "generic_http" does not define a stdio upstream'
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("fails profile test for invalid timeout values", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(join(root, ".switchboard.yaml"), "version: 1\nprofiles: {}\n");

    const errors: string[] = [];
    const program = createProgram({ writeErr: (message) => errors.push(message) });
    await program.parseAsync(
      ["--cwd", root, "test", "missing", "--timeout-ms", "0"],
      {
        from: "user"
      }
    );

    expect(errors).toEqual(["error: --timeout-ms must be a positive integer"]);
    expect(process.exitCode).toBe(1);
  });

  it("prints Codex install dry-run JSON for configured stdio profiles", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(
      [
        "--cwd",
        root,
        "install",
        "codex",
        "--json",
        "--server-name",
        "switchboard-local",
        "--command",
        "/opt/bin/switchboard"
      ],
      {
        from: "user"
      }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      client: string;
      serverName: string;
      content: string;
    };
    expect(parsed.client).toBe("codex");
    expect(parsed.serverName).toBe("switchboard-local");
    expect(parsed.content).toContain('[mcp_servers."switchboard-local"]');
    expect(parsed.content).toContain('command = "/opt/bin/switchboard"');
    expect(parsed.content).toContain(`args = ["--cwd", "${root}", "mcp"]`);
  });

  it("prints Claude install dry-run JSON for configured stdio profiles", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "install", "claude", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      client: string;
      content: string;
    };
    expect(parsed.client).toBe("claude");
    expect(JSON.parse(parsed.content)).toEqual({
      mcpServers: {
        switchboard: {
          command: "switchboard",
          args: ["--cwd", root, "mcp"],
          env: {}
        }
      }
    });
  });

  it("writes project-scoped Codex install config as JSON", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(
      ["--cwd", root, "install", "codex", "--write", "--json"],
      {
        from: "user"
      }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      client: string;
      targetPath: string;
      backupPath: string | null;
      action: string;
    };
    const targetPath = join(root, ".codex", "config.toml");
    expect(parsed).toMatchObject({
      client: "codex",
      targetPath,
      backupPath: null,
      action: "created"
    });
    expect(readFileSync(targetPath, "utf8")).toContain(
      `args = ["--cwd", "${root}", "mcp"]`
    );
  });

  it("writes project-scoped Claude config and backs up updates", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);
    writeFileSync(
      join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          switchboard: {
            command: "old",
            args: ["serve"]
          }
        }
      })
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(
      ["--cwd", root, "install", "claude", "--write", "--json"],
      {
        from: "user"
      }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      action: string;
      backupPath: string | null;
    };
    expect(parsed.action).toBe("updated");
    expect(parsed.backupPath).toContain(".mcp.json.switchboard-backup-");
    expect(JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: {
        switchboard: {
          command: "switchboard",
          args: ["--cwd", root, "mcp"],
          env: {}
        }
      }
    });
    expect(readFileSync(parsed.backupPath ?? "", "utf8")).toContain("old");
  });

  it("rolls back project-scoped install config from a backup", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);
    const targetPath = join(root, ".mcp.json");
    const backupPath = join(root, "claude.backup.json");
    writeFileSync(targetPath, '{"current":true}\n');
    writeFileSync(backupPath, '{"restored":true}\n');

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(
      [
        "--cwd",
        root,
        "install",
        "claude",
        "--rollback",
        "claude.backup.json",
        "--json"
      ],
      {
        from: "user"
      }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      targetPath: string;
      restoredFrom: string;
      backupPath: string | null;
    };
    expect(parsed.targetPath).toBe(targetPath);
    expect(parsed.restoredFrom).toBe(backupPath);
    expect(parsed.backupPath).toContain(".mcp.json.switchboard-backup-");
    expect(readFileSync(targetPath, "utf8")).toBe('{"restored":true}\n');
  });

  it("rolls back project-scoped install config when Switchboard config is invalid", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(join(root, ".switchboard.yaml"), "version: nope\n");
    const targetPath = join(root, ".mcp.json");
    const backupPath = join(root, "claude.backup.json");
    writeFileSync(targetPath, '{"current":true}\n');
    writeFileSync(backupPath, '{"restored":true}\n');

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(
      [
        "--cwd",
        root,
        "install",
        "claude",
        "--rollback",
        "claude.backup.json",
        "--json"
      ],
      {
        from: "user"
      }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      targetPath: string;
      restoredFrom: string;
    };
    expect(parsed.targetPath).toBe(targetPath);
    expect(parsed.restoredFrom).toBe(backupPath);
    expect(readFileSync(targetPath, "utf8")).toBe('{"restored":true}\n');
    expect(process.exitCode).toBeUndefined();
  });

  it("rolls back project-scoped install config at the repo root from nested cwd", async () => {
    const root = makeTempProject();
    const nested = join(root, "nested");
    mkdirSync(nested);
    writeStdioConfig(root);
    const targetPath = join(root, ".mcp.json");
    const backupPath = join(root, "claude.backup.json");
    writeFileSync(targetPath, '{"current":true}\n');
    writeFileSync(backupPath, '{"restored":true}\n');

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(
      [
        "--cwd",
        nested,
        "install",
        "claude",
        "--rollback",
        "claude.backup.json",
        "--json"
      ],
      {
        from: "user"
      }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      targetPath: string;
      restoredFrom: string;
    };
    expect(parsed.targetPath).toBe(targetPath);
    expect(parsed.restoredFrom).toBe(backupPath);
    expect(readFileSync(targetPath, "utf8")).toBe('{"restored":true}\n');
    expect(existsSync(join(nested, ".mcp.json"))).toBe(false);
  });

  it("fails install when write and rollback are both requested", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);

    const errors: string[] = [];
    const program = createProgram({ writeErr: (message) => errors.push(message) });
    await program.parseAsync(
      [
        "--cwd",
        root,
        "install",
        "claude",
        "--write",
        "--rollback",
        join(root, "backup.json")
      ],
      {
        from: "user"
      }
    );

    expect(errors).toEqual([
      "error: use either --write or --rollback, not both"
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("fails install for unsupported clients", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);

    const errors: string[] = [];
    const program = createProgram({ writeErr: (message) => errors.push(message) });
    await program.parseAsync(["--cwd", root, "install", "cursor"], {
      from: "user"
    });

    expect(errors).toEqual([
      "error: supported install clients are: codex, claude"
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("fails install when no stdio upstream profiles are configured", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  generic_http:",
        "    provider: generic",
        "    upstream:",
        "      type: http",
        "      url: http://localhost:3000/mcp"
      ].join("\n")
    );

    const errors: string[] = [];
    const program = createProgram({ writeErr: (message) => errors.push(message) });
    await program.parseAsync(["--cwd", root, "install", "codex"], {
      from: "user"
    });

    expect(errors).toEqual(["error: no stdio upstream profiles are configured"]);
    expect(process.exitCode).toBe(1);
  });

  it("fails install for invalid server names and commands", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);

    const errors: string[] = [];
    const program = createProgram({ writeErr: (message) => errors.push(message) });
    await program.parseAsync(
      [
        "--cwd",
        root,
        "install",
        "codex",
        "--server-name",
        "switchboard\nlocal",
        "--command",
        ""
      ],
      {
        from: "user"
      }
    );

    expect(errors).toEqual([
      "error: server name must not contain control characters",
      "error: command must not be empty"
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("creates and shows repo-scoped mandate JSON", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const mandateStorePath = join(root, "state", "mandates.json");

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath
    });
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "implementer",
        "--profiles",
        "github_findu,vercel_preview",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--allow-tool",
        "github_findu_*",
        "--deny-tool",
        "*_deploy_prod",
        "--require-approval-tool",
        "github_findu_checks_rerun",
        "--require-approval-reason",
        "rerunning CI changes remote state",
        "--require-approval-risk",
        "high",
        "--require-approval-label",
        "remote-state",
        "--require-approval-label",
        "ci",
        "--json"
      ],
      {
        from: "user"
      }
    );

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      path: mandateStorePath,
      mandate: {
        id: "fix-ci",
        task: "fix-ci",
        repoPath: root,
        worktreePath: root,
        branch: "fix/ci",
        agentRole: "implementer",
        profiles: ["github_findu", "vercel_preview"],
        allowedTools: ["github_findu_*"],
        deniedTools: ["*_deploy_prod"],
        approvalGates: [
          {
            id: "gate-1",
            toolPattern: "github_findu_checks_rerun",
            reason: "rerunning CI changes remote state",
            risk: "high",
            labels: ["remote-state", "ci"]
          }
        ],
        lease: "2h",
        runtimeStatus: "active"
      },
      mcpLaunch: {
        schemaVersion: "switchboard.mcp-launch.v1",
        transport: "stdio",
        mandateId: "fix-ci",
        cwd: root,
        command: "switchboard",
        args: ["--cwd", root, "mcp", "--mandate", "fix-ci"],
        commandCandidates: [
          {
            kind: "path",
            command: "switchboard",
            args: ["--cwd", root, "mcp", "--mandate", "fix-ci"],
            description: expect.any(String)
          },
          {
            kind: "source-entrypoint",
            command: "pnpm",
            args: [
              "--dir",
              expect.stringMatching(/apps[/\\]cli$/),
              "exec",
              "tsx",
              "--conditions",
              "source",
              "src/index.ts",
              "--cwd",
              root,
              "mcp",
              "--mandate",
              "fix-ci"
            ],
            description: expect.any(String)
          }
        ],
        installHint: expect.stringContaining("switchboard binary is on PATH")
      }
    });

    await program.parseAsync(["--cwd", root, "mandate", "status", "--json"], {
      from: "user"
    });

    expect(JSON.parse(output[1] ?? "{}")).toMatchObject({
      schemaVersion: "switchboard.mandate-status.v1",
      path: mandateStorePath,
      repoPath: root,
      mandates: [
        {
          id: "fix-ci",
          branch: "fix/ci",
          agentRole: "implementer",
          allowedTools: ["github_findu_*"],
          deniedTools: ["*_deploy_prod"],
          approvalGates: [
            {
              id: "gate-1",
              toolPattern: "github_findu_checks_rerun",
              reason: "rerunning CI changes remote state",
              risk: "high",
              labels: ["remote-state", "ci"]
            }
          ],
          runtimeStatus: "active"
        }
      ]
    });

    await program.parseAsync(["--cwd", root, "mandate", "status"], {
      from: "user"
    });
    expect(output[2]).toContain("allow:github_findu_*");
    expect(output[2]).toContain("deny:*_deploy_prod");
    expect(output[2]).toContain(
      "approval:gate-1:github_findu_checks_rerun(risk:high labels:remote-state+ci reason:rerunning CI changes remote state)"
    );
  });

  it("creates child mandates with inherited parent scope", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const mandateStorePath = join(root, "state", "mandates.json");

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath
    });
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "lead",
        "--profiles",
        "github_findu,vercel_preview",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--allow-tool",
        "github_findu_*",
        "--deny-tool",
        "*_deploy_prod",
        "--require-approval-tool",
        "github_findu_checks_rerun",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "child",
        "rerun checks",
        "--parent",
        "fix-ci",
        "--agent",
        "worker",
        "--delegated-by",
        "lead-agent",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "30m",
        "--allow-tool",
        "github_findu_checks_*",
        "--deny-tool",
        "github_findu_checks_cancel",
        "--json"
      ],
      { from: "user" }
    );

    expect(JSON.parse(output[1] ?? "{}")).toMatchObject({
      path: mandateStorePath,
      mandate: {
        id: "rerun-checks",
        parentMandateId: "fix-ci",
        delegatedBy: "lead-agent",
        delegationPath: ["fix-ci", "rerun-checks"],
        agentRole: "worker",
        profiles: ["github_findu"],
        allowedTools: ["github_findu_checks_*"],
        deniedTools: ["*_deploy_prod", "github_findu_checks_cancel"],
        approvalGates: [
          {
            id: "gate-1",
            toolPattern: "github_findu_checks_rerun"
          }
        ],
        runtimeStatus: "active"
      },
      mcpLaunch: {
        schemaVersion: "switchboard.mcp-launch.v1",
        mandateId: "rerun-checks",
        cwd: root,
        args: ["--cwd", root, "mcp", "--mandate", "rerun-checks"],
        commandCandidates: [
          expect.objectContaining({
            kind: "path",
            command: "switchboard",
            args: ["--cwd", root, "mcp", "--mandate", "rerun-checks"]
          }),
          expect.objectContaining({
            kind: "source-entrypoint",
            command: "pnpm",
            args: [
              "--dir",
              expect.stringMatching(/apps[/\\]cli$/),
              "exec",
              "tsx",
              "--conditions",
              "source",
              "src/index.ts",
              "--cwd",
              root,
              "mcp",
              "--mandate",
              "rerun-checks"
            ]
          })
        ]
      }
    });
  });

  it("rejects duplicate inherited child approval gates", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const mandateStorePath = join(root, "state", "mandates.json");
    const output: string[] = [];
    const errors: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      writeErr: (message) => errors.push(message),
      mandateStorePath
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "lead",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--require-approval-tool",
        "github_findu_checks_rerun",
        "--require-approval-reason",
        "parent approval reason",
        "--json"
      ],
      { from: "user" }
    );
    process.exitCode = undefined;

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "child",
        "rerun checks",
        "--parent",
        "fix-ci",
        "--agent",
        "worker",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "30m",
        "--require-approval-tool",
        "github_findu_checks_rerun",
        "--require-approval-reason",
        "child override reason",
        "--json"
      ],
      { from: "user" }
    );

    expect(errors).toEqual([]);
    expect(JSON.parse(output[1] ?? "{}")).toEqual({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "child_mandate_create_failed",
      message:
        'child approval gate "github_findu_checks_rerun" is already inherited from parent mandate "fix-ci"; omit the duplicate gate or choose a narrower tool pattern',
      nextActions: []
    });
    expect(process.exitCode).toBe(1);
  });

  it("rejects child mandates that exceed parent profile scope", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const errors: string[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message),
      mandateStorePath: join(root, "state", "mandates.json")
    });
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "lead",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "child",
        "preview deploy",
        "--parent",
        "fix-ci",
        "--agent",
        "worker",
        "--profiles",
        "vercel_preview",
        "--branch",
        "fix/ci",
        "--lease",
        "30m"
      ],
      { from: "user" }
    );

    expect(errors).toEqual([
      "error: child mandate profiles exceed parent scope: vercel_preview"
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("rejects child mandates that exceed parent allowed tool scope", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const errors: string[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message),
      mandateStorePath: join(root, "state", "mandates.json")
    });
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "lead",
        "--profiles",
        "github_findu,vercel_preview",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--allow-tool",
        "github_findu_*",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "child",
        "preview deploy",
        "--parent",
        "fix-ci",
        "--agent",
        "worker",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "30m",
        "--allow-tool",
        "vercel_preview_*"
      ],
      { from: "user" }
    );

    expect(errors).toEqual([
      "error: child mandate allowed tools exceed parent tool scope"
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("reports mandate handoff across parent and child chains", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const mandateStorePath = join(root, "state", "mandates.json");
    const auditLogPath = join(root, "state", "logs", "switchboard.jsonl");
    const approvalStorePath = join(root, "state", "approvals.json");
    mkdirSync(join(root, "state", "logs"), { recursive: true });
    writeFileSync(
      auditLogPath,
      [
        {
          version: 1,
          timestamp: "2026-06-19T16:20:00.000Z",
          action: "tool_call",
          status: "ok",
          profileName: "github_findu",
          toolName: "github_findu_checks_list",
          mandateId: "fix-ci",
          repoPath: root
        },
        {
          version: 1,
          timestamp: "2026-06-19T16:25:00.000Z",
          action: "tool_call",
          status: "ok",
          profileName: "github_findu",
          toolName: "github_findu_checks_rerun",
          mandateId: "rerun-checks",
          repoPath: root
        },
        {
          version: 1,
          timestamp: "2026-06-19T16:30:00.000Z",
          action: "tool_call",
          status: "ok",
          profileName: "github_findu",
          toolName: "github_findu_checks_list",
          mandateId: "fix-ci",
          repoPath: join(root, "other-repo")
        }
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n"
    );

    const output: string[] = [];
    const errors: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      writeErr: (message) => errors.push(message),
      mandateStorePath,
      auditLogPath,
      approvalStorePath
    });
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "lead",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "child",
        "rerun checks",
        "--parent",
        "fix-ci",
        "--agent",
        "worker",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "30m",
        "--json"
      ],
      { from: "user" }
    );
    const mandateStore = JSON.parse(readFileSync(mandateStorePath, "utf8")) as {
      mandates: Array<{
        id: string;
        mandateUid?: string;
        parentMandateId?: string;
        parentMandateUid?: string;
        delegatedBy?: string;
        delegationPath?: string[];
        delegationUids?: string[];
      }>;
    };
    const childMandate = mandateStore.mandates.find(
      (mandate) => mandate.id === "rerun-checks"
    );
    expect(childMandate).toBeDefined();
    await createApprovalRequest({
      path: approvalStorePath,
      now: () => new Date("2026-06-19T16:22:00.000Z"),
      mandateId: "rerun-checks",
      ...(childMandate?.mandateUid ? { mandateUid: childMandate.mandateUid } : {}),
      ...(childMandate?.parentMandateId
        ? { parentMandateId: childMandate.parentMandateId }
        : {}),
      ...(childMandate?.parentMandateUid
        ? { parentMandateUid: childMandate.parentMandateUid }
        : {}),
      ...(childMandate?.delegatedBy ? { delegatedBy: childMandate.delegatedBy } : {}),
      ...(childMandate?.delegationPath
        ? { delegationPath: childMandate.delegationPath }
        : {}),
      ...(childMandate?.delegationUids
        ? { delegationUids: childMandate.delegationUids }
        : {}),
      repoPath: root,
      branch: "fix/ci",
      toolName: "github_findu_checks_rerun",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_checks_rerun",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    });
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "handoff",
        "fix-ci",
        "--state",
        "completed",
        "--summary",
        "parent done"
      ],
      { from: "user" }
    );
    expect(errors).toEqual([
      'error: cannot hand off mandate "fix-ci" while readiness blockers remain: child mandate "rerun-checks" remains open; approval request "approval-1" is pending. Use --ignore-readiness to close anyway.'
    ]);
    process.exitCode = undefined;

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "handoff",
        "rerun-checks",
        "--state",
        "completed",
        "--summary",
        "checks are green",
        "--next-step",
        "merge PR",
        "--artifact",
        "https://github.com/woverfield/switchboard/pull/214",
        "--by",
        "worker-agent",
        "--json"
      ],
      { from: "user" }
    );
    expect(errors).toEqual([
      'error: cannot hand off mandate "fix-ci" while readiness blockers remain: child mandate "rerun-checks" remains open; approval request "approval-1" is pending. Use --ignore-readiness to close anyway.'
    ]);
    expect(JSON.parse(output[2] ?? "{}")).toEqual({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "mandate_readiness_blocked",
      message:
        'cannot hand off mandate "rerun-checks" while readiness blockers remain: approval request "approval-1" is pending. Use --ignore-readiness to close anyway.',
      nextActions: [
        "switchboard approve approval-1 or switchboard deny approval-1"
      ]
    });
    process.exitCode = undefined;
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "handoff",
        "rerun-checks",
        "--state",
        "completed",
        "--summary",
        "checks are green",
        "--next-step",
        "merge PR",
        "--artifact",
        "https://github.com/woverfield/switchboard/pull/214",
        "--by",
        "worker-agent",
        "--ignore-readiness",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "handoff",
        "fix-ci",
        "--state",
        "completed",
        "--summary",
        "parent done",
        "--ignore-readiness",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "mandate", "report", "rerun-checks", "--json"],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "mandate", "report", "rerun-checks"],
      { from: "user" }
    );

    expect(JSON.parse(output[3] ?? "{}")).toMatchObject({
      path: mandateStorePath,
      mandate: {
        id: "rerun-checks",
        handoffState: "completed",
        handoffSummary: "checks are green",
        handoffNextSteps: ["merge PR"],
        handoffArtifacts: [
          "https://github.com/woverfield/switchboard/pull/214"
        ],
        handoffBy: "worker-agent",
        runtimeStatus: "closed"
      }
    });
    expect(JSON.parse(output[5] ?? "{}")).toMatchObject({
      schemaVersion: "switchboard.mandate-report.v1",
      path: mandateStorePath,
      auditLogPath,
      repoPath: root,
      selectedMandateId: "rerun-checks",
      rootMandateId: "fix-ci",
      counts: {
        mandates: 2,
        open: 0,
        completed: 2,
        blocked: 0,
        cancelled: 0,
        closed: 2,
        auditEntries: 2,
        approvalRequests: 1
      },
      results: {
        counts: {
          handoffs: 2,
          completed: 2,
          blocked: 0,
          cancelled: 0,
          open: 0,
          summaries: 2,
          nextSteps: 1,
          artifacts: 1
        },
        handoffs: [
          {
            id: "fix-ci",
            state: "completed",
            summary: "parent done",
            nextSteps: [],
            artifacts: []
          },
          {
            id: "rerun-checks",
            parentMandateId: "fix-ci",
            state: "completed",
            summary: "checks are green",
            nextSteps: ["merge PR"],
            artifacts: ["https://github.com/woverfield/switchboard/pull/214"],
            by: "worker-agent"
          }
        ],
        openMandates: [],
        nextSteps: [
          {
            mandateId: "rerun-checks",
            value: "merge PR"
          }
        ],
        artifacts: [
          {
            mandateId: "rerun-checks",
            value: "https://github.com/woverfield/switchboard/pull/214"
          }
        ]
      },
      childrenByParent: {
        "fix-ci": ["rerun-checks"]
      },
      mandates: [
        {
          id: "fix-ci",
          handoffState: "completed",
          runtimeStatus: "closed"
        },
        {
          id: "rerun-checks",
          parentMandateId: "fix-ci",
          handoffState: "completed",
          runtimeStatus: "closed"
        }
      ],
      approvalRequests: [
        {
          mandateId: "rerun-checks",
          parentMandateId: "fix-ci",
          delegationPath: ["fix-ci", "rerun-checks"],
          toolName: "github_findu_checks_rerun"
        }
      ],
      auditEntries: [
        {
          mandateId: "fix-ci",
          toolName: "github_findu_checks_list"
        },
        {
          mandateId: "rerun-checks",
          toolName: "github_findu_checks_rerun"
        }
      ]
    });
    expect(output[6]).toContain("Results: handoffs:2 summaries:2 nextSteps:1 artifacts:1");
    expect(output[6]).toContain("Handoff results:");
    expect(output[6]).toContain("rerun-checks completed by:worker-agent");
    expect(output[6]).toContain("at:");
    expect(output[6]).toContain("Next: merge PR");
    expect(output[6]).toContain(
      "Artifacts: https://github.com/woverfield/switchboard/pull/214"
    );
  });

  it("reports the latest same-id mandate chain without old chain or other repo audit leakage", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const mandateStorePath = join(root, "state", "mandates.json");
    const auditLogPath = join(root, "state", "logs", "switchboard.jsonl");
    const approvalStorePath = join(root, "state", "approvals.json");
    mkdirSync(join(root, "state", "logs"), { recursive: true });
    writeFileSync(
      mandateStorePath,
      JSON.stringify(
        {
          version: 1,
          mandates: [
            {
              version: 1,
              id: "fix-ci",
              mandateUid: "fix-ci:2026-06-19T16:00:00.000Z",
              task: "fix-ci",
              repoPath: root,
              worktreePath: root,
              branch: "fix/ci",
              agentRole: "lead",
              profiles: ["github_findu"],
              lease: "1h",
              createdAt: "2026-06-19T16:00:00.000Z",
              expiresAt: "2026-06-19T17:00:00.000Z",
              allowedTools: [],
              deniedTools: [],
              approvalGates: [],
              handoffState: "completed",
              handoffAt: "2026-06-19T16:30:00.000Z"
            },
            {
              version: 1,
              id: "rerun-checks",
              mandateUid: "rerun-checks:2026-06-19T16:10:00.000Z",
              task: "rerun checks",
              parentMandateId: "fix-ci",
              parentMandateUid: "fix-ci:2026-06-19T16:00:00.000Z",
              delegationPath: ["fix-ci", "rerun-checks"],
              delegationUids: [
                "fix-ci:2026-06-19T16:00:00.000Z",
                "rerun-checks:2026-06-19T16:10:00.000Z"
              ],
              repoPath: root,
              worktreePath: root,
              branch: "fix/ci",
              agentRole: "worker",
              profiles: ["github_findu"],
              lease: "30m",
              createdAt: "2026-06-19T16:10:00.000Z",
              expiresAt: "2026-06-19T16:40:00.000Z",
              allowedTools: [],
              deniedTools: [],
              approvalGates: [],
              handoffState: "completed",
              handoffAt: "2026-06-19T16:35:00.000Z"
            },
            {
              version: 1,
              id: "fix-ci",
              mandateUid: "fix-ci:2026-06-19T18:00:00.000Z",
              task: "fix-ci",
              repoPath: root,
              worktreePath: root,
              branch: "fix/ci",
              agentRole: "lead",
              profiles: ["github_findu"],
              lease: "1h",
              createdAt: "2026-06-19T18:00:00.000Z",
              expiresAt: "2026-06-19T19:00:00.000Z",
              allowedTools: [],
              deniedTools: [],
              approvalGates: [],
              handoffState: "open"
            }
          ]
        },
        null,
        2
      ) + "\n"
    );
    writeFileSync(
      auditLogPath,
      [
        {
          version: 1,
          timestamp: "2026-06-19T16:20:00.000Z",
          action: "tool_call",
          status: "ok",
          mandateId: "rerun-checks",
          mandateUid: "rerun-checks:2026-06-19T16:10:00.000Z",
          repoPath: root,
          toolName: "old_child_tool"
        },
        {
          version: 1,
          timestamp: "2026-06-19T18:05:00.000Z",
          action: "tool_call",
          status: "ok",
          mandateId: "fix-ci",
          mandateUid: "fix-ci:2026-06-19T18:00:00.000Z",
          repoPath: root,
          toolName: "new_parent_tool"
        },
        {
          version: 1,
          timestamp: "2026-06-19T18:10:00.000Z",
          action: "tool_call",
          status: "ok",
          mandateId: "fix-ci",
          mandateUid: "fix-ci:2026-06-19T18:00:00.000Z",
          repoPath: join(root, "other-repo"),
          toolName: "other_repo_tool"
        }
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n"
    );
    await createApprovalRequest({
      path: approvalStorePath,
      now: () => new Date("2026-06-19T16:22:00.000Z"),
      mandateId: "rerun-checks",
      mandateUid: "rerun-checks:2026-06-19T16:10:00.000Z",
      parentMandateId: "fix-ci",
      parentMandateUid: "fix-ci:2026-06-19T16:00:00.000Z",
      delegationPath: ["fix-ci", "rerun-checks"],
      delegationUids: [
        "fix-ci:2026-06-19T16:00:00.000Z",
        "rerun-checks:2026-06-19T16:10:00.000Z"
      ],
      repoPath: root,
      branch: "fix/ci",
      toolName: "old_child_approval",
      approvalGateId: "gate-1",
      approvalGatePattern: "old_child_approval",
      expiresAt: "2026-06-19T16:40:00.000Z"
    });
    await createApprovalRequest({
      path: approvalStorePath,
      now: () => new Date("2026-06-19T18:06:00.000Z"),
      mandateId: "fix-ci",
      mandateUid: "fix-ci:2026-06-19T18:00:00.000Z",
      delegationPath: ["fix-ci"],
      delegationUids: ["fix-ci:2026-06-19T18:00:00.000Z"],
      repoPath: root,
      branch: "fix/ci",
      toolName: "new_parent_approval",
      approvalGateId: "gate-1",
      approvalGatePattern: "new_parent_approval",
      expiresAt: "2026-06-19T18:40:00.000Z"
    });

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath,
      auditLogPath,
      approvalStorePath
    });
    await program.parseAsync(
      ["--cwd", root, "mandate", "report", "fix-ci", "--json"],
      { from: "user" }
    );

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      schemaVersion: "switchboard.mandate-report.v1",
      selectedMandateUid: "fix-ci:2026-06-19T18:00:00.000Z",
      rootMandateUid: "fix-ci:2026-06-19T18:00:00.000Z",
      counts: {
        mandates: 1,
        auditEntries: 1,
        approvalRequests: 1
      },
      mandates: [
        {
          id: "fix-ci",
          mandateUid: "fix-ci:2026-06-19T18:00:00.000Z"
        }
      ],
      approvalRequests: [
        {
          mandateId: "fix-ci",
          mandateUid: "fix-ci:2026-06-19T18:00:00.000Z",
          toolName: "new_parent_approval"
        }
      ],
      auditEntries: [
        {
          mandateId: "fix-ci",
          mandateUid: "fix-ci:2026-06-19T18:00:00.000Z",
          toolName: "new_parent_tool"
        }
      ]
    });
  });

  it("reports mandate tree readiness blockers for open children and pending approvals", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const mandateStorePath = join(root, "state", "mandates.json");
    const approvalStorePath = join(root, "state", "approvals.json");
    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath,
      approvalStorePath
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "lead",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "child",
        "rerun checks",
        "--parent",
        "fix-ci",
        "--agent",
        "worker",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "30m",
        "--json"
      ],
      { from: "user" }
    );

    const child = JSON.parse(output[1] ?? "{}").mandate as {
      id: string;
      mandateUid: string;
      parentMandateId: string;
      parentMandateUid: string;
      delegationPath: string[];
      delegationUids: string[];
    };
    await createApprovalRequest({
      path: approvalStorePath,
      now: () => new Date("2026-06-19T16:22:00.000Z"),
      mandateId: child.id,
      mandateUid: child.mandateUid,
      parentMandateId: child.parentMandateId,
      parentMandateUid: child.parentMandateUid,
      delegationPath: child.delegationPath,
      delegationUids: child.delegationUids,
      repoPath: root,
      branch: "fix/ci",
      toolName: "github_findu_checks_rerun",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_checks_rerun",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    });

    await program.parseAsync(
      ["--cwd", root, "mandate", "report", "fix-ci", "--json"],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "mandate", "escalate", "fix-ci", "--json"],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "mandate", "escalate", "fix-ci"],
      { from: "user" }
    );

    expect(JSON.parse(output[2] ?? "{}")).toMatchObject({
      readiness: {
        selectedCanHandoff: false,
        selectedHandoffState: "open",
        openChildMandates: [
          {
            id: "rerun-checks",
            mandateUid: child.mandateUid,
            agentRole: "worker",
            branch: "fix/ci"
          }
        ],
        pendingApprovalRequests: [
          {
            id: "approval-1",
            mandateId: "rerun-checks",
            mandateUid: child.mandateUid,
            toolName: "github_findu_checks_rerun",
            approvalGateId: "gate-1"
          }
        ],
        blockers: [
          'child mandate "rerun-checks" remains open',
          'approval request "approval-1" is pending'
        ],
        nextActions: [
          "switchboard mandate handoff rerun-checks --state completed --summary <summary>",
          "switchboard approve approval-1 or switchboard deny approval-1"
        ]
      }
    });
    expect(JSON.parse(output[3] ?? "{}")).toMatchObject({
      schemaVersion: "switchboard.mandate-escalation.v1",
      reportSchemaVersion: "switchboard.mandate-report.v1",
      status: "needs_attention",
      counts: {
        items: 2,
        approvalRequests: 1,
        openChildMandates: 1,
        blockedHandoffs: 0,
        cancelledHandoffs: 0
      },
      nextCommands: [
        "switchboard approve approval-1",
        "switchboard deny approval-1",
        "switchboard mandate report rerun-checks --json",
        "switchboard mandate handoff rerun-checks --state completed --summary <summary>"
      ],
      items: [
        {
          type: "approval_request",
          priority: "decision",
          mandateId: "rerun-checks",
          mandateUid: child.mandateUid,
          approvalRequestId: "approval-1",
          toolName: "github_findu_checks_rerun",
          approvalGateId: "gate-1"
        },
        {
          type: "open_child_mandate",
          priority: "handoff",
          mandateId: "rerun-checks",
          mandateUid: child.mandateUid
        }
      ]
    });
    expect(JSON.parse(output[3] ?? "{}").copyText).toContain(
      "Switchboard escalation for mandate fix-ci"
    );
    expect(output[4]).toContain("Switchboard mandate escalation");
    expect(output[4]).toContain("Status: needs_attention");
    expect(output[4]).toContain("approval_request rerun-checks");
    expect(output[4]).toContain("open_child_mandate rerun-checks");
    expect(output[4]).toContain("switchboard approve approval-1");
  });

  it("escalates blocked mandate handoffs for review", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const mandateStorePath = join(root, "state", "mandates.json");
    mkdirSync(join(root, "state"), { recursive: true });
    writeFileSync(
      mandateStorePath,
      JSON.stringify(
        {
          version: 1,
          mandates: [
            {
              version: 1,
              id: "fix-ci",
              mandateUid: "fix-ci:2026-06-21T14:00:00.000Z",
              task: "fix-ci",
              repoPath: root,
              worktreePath: root,
              branch: "fix/ci",
              agentRole: "lead",
              profiles: ["github_findu"],
              lease: "2h",
              createdAt: "2026-06-21T14:00:00.000Z",
              expiresAt: "2026-06-21T16:00:00.000Z",
              allowedTools: [],
              deniedTools: [],
              approvalGates: [],
              handoffState: "open"
            },
            {
              version: 1,
              id: "rerun-checks",
              mandateUid: "rerun-checks:2026-06-21T14:10:00.000Z",
              task: "rerun checks",
              parentMandateId: "fix-ci",
              parentMandateUid: "fix-ci:2026-06-21T14:00:00.000Z",
              delegatedBy: "fix-ci",
              delegationPath: ["fix-ci", "rerun-checks"],
              delegationUids: [
                "fix-ci:2026-06-21T14:00:00.000Z",
                "rerun-checks:2026-06-21T14:10:00.000Z"
              ],
              repoPath: root,
              worktreePath: root,
              branch: "fix/ci",
              agentRole: "worker",
              profiles: ["github_findu"],
              lease: "30m",
              createdAt: "2026-06-21T14:10:00.000Z",
              expiresAt: "2026-06-21T14:40:00.000Z",
              allowedTools: [],
              deniedTools: [],
              approvalGates: [],
              handoffState: "blocked",
              handoffSummary: "GitHub checks API is returning 503",
              handoffNextSteps: ["retry when checks API recovers"],
              handoffArtifacts: ["https://github.com/woverfield/switchboard/actions"],
              handoffBy: "worker-agent",
              handoffAt: "2026-06-21T14:20:00.000Z"
            }
          ]
        },
        null,
        2
      ) + "\n"
    );
    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath,
      approvalStorePath: join(root, "state", "approvals.json")
    });

    await program.parseAsync(
      ["--cwd", root, "mandate", "escalate", "fix-ci", "--json"],
      { from: "user" }
    );

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      schemaVersion: "switchboard.mandate-escalation.v1",
      status: "needs_attention",
      counts: {
        items: 1,
        blockedHandoffs: 1,
        cancelledHandoffs: 0
      },
      items: [
        {
          type: "blocked_handoff",
          priority: "review",
          mandateId: "rerun-checks",
          mandateUid: "rerun-checks:2026-06-21T14:10:00.000Z",
          state: "blocked",
          summary: "GitHub checks API is returning 503",
          nextSteps: ["retry when checks API recovers"],
          artifacts: ["https://github.com/woverfield/switchboard/actions"],
          commands: ["switchboard mandate report rerun-checks --json"]
        }
      ]
    });
  });

  it("rejects mismatched approval gate reason counts", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const errors: string[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message),
      mandateStorePath: join(root, "state", "mandates.json")
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "implementer",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--require-approval-reason",
        "needs a human"
      ],
      { from: "user" }
    );

    expect(errors).toEqual([
      "error: --require-approval-reason must be provided once for each --require-approval-tool"
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("rejects mismatched approval gate risk counts", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const errors: string[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message),
      mandateStorePath: join(root, "state", "mandates.json")
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "implementer",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--require-approval-risk",
        "high"
      ],
      { from: "user" }
    );

    expect(errors).toEqual([
      "error: --require-approval-risk must be provided once for each --require-approval-tool"
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("prints JSON error envelopes for mandate command failures", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const output: string[] = [];
    const errors: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      writeErr: (message) => errors.push(message),
      mandateStorePath: join(root, "state", "mandates.json")
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "implementer",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--require-approval-reason",
        "needs a human",
        "--json"
      ],
      { from: "user" }
    );

    expect(errors).toEqual([]);
    expect(JSON.parse(output[0] ?? "{}")).toEqual({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "invalid_approval_gate_options",
      message:
        "--require-approval-reason must be provided once for each --require-approval-tool",
      nextActions: []
    });
    expect(process.exitCode).toBe(1);
  });

  it("prints JSON error envelopes for mandate parser failures", async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      writeErr: (message) => errors.push(message)
    });

    await expect(
      program.parseAsync(["mandate", "create", "fix-ci", "--json"], {
        from: "user"
      })
    ).rejects.toMatchObject({ exitCode: 1 });
    await expect(
      program.parseAsync(["mandate", "status", "--bogus", "--json"], {
        from: "user"
      })
    ).rejects.toMatchObject({ exitCode: 1 });
    await expect(
      program.parseAsync(["mandate", "report", "--json"], {
        from: "user"
      })
    ).rejects.toMatchObject({ exitCode: 1 });

    expect(errors).toEqual([]);
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "missing_required_option",
      message: "required option '--agent <role>' not specified"
    });
    expect(JSON.parse(output[1] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "unknown_option",
      message: "unknown option '--bogus'"
    });
    expect(JSON.parse(output[2] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "missing_required_argument",
      message: "missing required argument 'id'"
    });
    expect(process.exitCode).toBe(1);
  });

  it("prints JSON error envelopes for invalid mandate command config", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      ["version: 1", "profiles:", "  broken:", "    namespace: '!!!'"].join(
        "\n"
      )
    );
    const output: string[] = [];
    const errors: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      writeErr: (message) => errors.push(message),
      mandateStorePath: join(root, "state", "mandates.json")
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "implementer",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--json"
      ],
      { from: "user" }
    );

    expect(errors).toEqual([]);
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "invalid_config",
      nextActions: ["Run switchboard doctor for config diagnostics."]
    });
    expect(process.exitCode).toBe(1);
  });

  it("uses a semantic JSON error code for missing mandate ids", async () => {
    const root = makeTempProject();
    const output: string[] = [];
    const errors: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      writeErr: (message) => errors.push(message),
      mandateStorePath: join(root, "state", "mandates.json"),
      approvalStorePath: join(root, "state", "approvals.json"),
      auditLogPath: join(root, "state", "logs", "switchboard.jsonl")
    });

    await program.parseAsync(
      ["--cwd", root, "mandate", "report", "missing", "--json"],
      { from: "user" }
    );
    process.exitCode = undefined;
    await program.parseAsync(
      ["--cwd", root, "mandate", "escalate", "missing", "--json"],
      { from: "user" }
    );
    process.exitCode = undefined;
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "handoff",
        "missing",
        "--state",
        "completed",
        "--json"
      ],
      { from: "user" }
    );

    expect(errors).toEqual([]);
    expect(output.map((message) => JSON.parse(message))).toEqual([
      {
        ok: false,
        schemaVersion: "switchboard.error.v1",
        code: "mandate_not_found",
        message: 'mandate "missing" was not found',
        nextActions: []
      },
      {
        ok: false,
        schemaVersion: "switchboard.error.v1",
        code: "mandate_not_found",
        message: 'mandate "missing" was not found',
        nextActions: []
      },
      {
        ok: false,
        schemaVersion: "switchboard.error.v1",
        code: "mandate_not_found",
        message: 'mandate "missing" was not found',
        nextActions: []
      }
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("fails mandate status for a missing id", async () => {
    const root = makeTempProject();
    const errors: string[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message),
      mandateStorePath: join(root, "state", "mandates.json")
    });

    await program.parseAsync(["--cwd", root, "mandate", "status", "missing"], {
      from: "user"
    });

    expect(errors).toEqual(['error: mandate "missing" was not found']);
    expect(process.exitCode).toBe(1);
  });

  it("prints a JSON error envelope for a missing mandate id", async () => {
    const root = makeTempProject();
    const output: string[] = [];
    const errors: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      writeErr: (message) => errors.push(message),
      mandateStorePath: join(root, "state", "mandates.json")
    });

    await program.parseAsync(
      ["--cwd", root, "mandate", "status", "missing", "--json"],
      {
        from: "user"
      }
    );

    expect(errors).toEqual([]);
    expect(JSON.parse(output[0] ?? "{}")).toEqual({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "mandate_not_found",
      message: 'mandate "missing" was not found',
      nextActions: []
    });
    expect(process.exitCode).toBe(1);
  });

  it("prints a JSON error envelope when mandate status cannot read state", async () => {
    const root = makeTempProject();
    const mandateStorePath = join(root, "state", "mandates.json");
    mkdirSync(join(root, "state"), { recursive: true });
    writeFileSync(mandateStorePath, "{bad json");
    const output: string[] = [];
    const errors: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      writeErr: (message) => errors.push(message),
      mandateStorePath
    });

    await program.parseAsync(["--cwd", root, "mandate", "status", "--json"], {
      from: "user"
    });

    expect(errors).toEqual([]);
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "mandate_status_failed"
    });
    expect(process.exitCode).toBe(1);
  });

  it("fails mandate create for missing profiles", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const errors: string[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message),
      mandateStorePath: join(root, "state", "mandates.json")
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "implementer",
        "--profiles",
        "github_findu,missing",
        "--branch",
        "fix/ci",
        "--lease",
        "2h"
      ],
      {
        from: "user"
      }
    );

    expect(errors).toEqual(["error: mandate profiles were not found: missing"]);
    expect(process.exitCode).toBe(1);
  });

  it("binds mandates to the actual git worktree and current branch", async () => {
    const root = makeTempProject();
    initGitRepo(root, "fix/ci");
    writeMandateConfig(root);
    const nested = join(root, "packages", "app");
    mkdirSync(nested, { recursive: true });
    const mandateStorePath = join(root, "state", "mandates.json");

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath
    });
    await program.parseAsync(
      [
        "--cwd",
        nested,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "implementer",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--json"
      ],
      {
        from: "user"
      }
    );

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      mandate: {
        repoPath: root,
        worktreePath: realpathSync(root),
        branch: "fix/ci"
      }
    });
  });

  it("rejects a mandate branch that does not match the current git branch", async () => {
    const root = makeTempProject();
    initGitRepo(root, "main");
    writeMandateConfig(root);
    const errors: string[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message),
      mandateStorePath: join(root, "state", "mandates.json")
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "implementer",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h"
      ],
      {
        from: "user"
      }
    );

    expect(errors).toEqual([
      `error: mandate branch "fix/ci" does not match current git branch "main" in ${realpathSync(root)}`
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("lists, approves, and denies local approval requests", async () => {
    const root = makeTempProject();
    const approvalStorePath = join(root, "state", "approvals.json");
    const createdAt = new Date();
    const futureExpiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const pastExpiresAt = new Date(Date.now() - 3_600_000).toISOString();
    await createApprovalRequest({
      path: approvalStorePath,
      now: () => createdAt,
      mandateId: "fix-ci",
      repoPath: root,
      branch: "fix/ci",
      toolName: "github_findu_deploy",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_deploy",
      approvalGateReason: "preview deploy touches remote state",
      approvalGateRisk: "high",
      approvalGateLabels: ["remote-state", "deploy"],
      expiresAt: futureExpiresAt
    });
    await createApprovalRequest({
      path: approvalStorePath,
      now: () => createdAt,
      mandateId: "fix-ci",
      repoPath: root,
      branch: "fix/ci",
      toolName: "github_findu_delete",
      approvalGateId: "gate-2",
      approvalGatePattern: "github_findu_delete",
      expiresAt: futureExpiresAt
    });
    await createApprovalRequest({
      path: approvalStorePath,
      now: () => createdAt,
      mandateId: "fix-ci",
      repoPath: root,
      branch: "fix/ci",
      toolName: "github_findu_expired",
      approvalGateId: "gate-3",
      approvalGatePattern: "github_findu_expired",
      expiresAt: pastExpiresAt
    });
    await createApprovalRequest({
      path: approvalStorePath,
      now: () => createdAt,
      mandateId: "fix-ci",
      repoPath: root,
      branch: "fix/ci",
      toolName: "github_findu_stale",
      approvalGateId: "gate-4",
      approvalGatePattern: "github_findu_stale",
      expiresAt: futureExpiresAt
    });
    await markApprovalRequestStale({
      path: approvalStorePath,
      id: "approval-4",
      reason: "client disconnected"
    });

    const output: string[] = [];
    const errors: string[] = [];
    const program = createProgram({
      approvalStorePath,
      writeOut: (message) => output.push(message),
      writeErr: (message) => errors.push(message)
    });

    await program.parseAsync(["--cwd", root, "approvals", "--json"], {
      from: "user"
    });
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      schemaVersion: "switchboard.approvals.v1",
      path: approvalStorePath,
      repoPath: root,
      includeChildren: false,
      counts: {
        requests: 4,
        pending: 2,
        expired: 1,
        stale: 1
      },
      requests: [
        { id: "approval-1", runtimeStatus: "pending" },
        { id: "approval-2", runtimeStatus: "pending" },
        { id: "approval-3", runtimeStatus: "expired" },
        { id: "approval-4", runtimeStatus: "stale" }
      ]
    });

    await program.parseAsync(["--cwd", root, "approvals"], {
      from: "user"
    });
    expect(output[1]).toContain(
      "next: switchboard approve approval-1 or switchboard deny approval-1; then retry github_findu_deploy"
    );
    expect(output[1]).toContain("reason:preview deploy touches remote state");
    expect(output[1]).toContain("risk:high");
    expect(output[1]).toContain("labels:remote-state+deploy");
    expect(output[1]).toContain(
      "next: retry the original gated tool call to create a fresh approval request"
    );

    await program.parseAsync(
      ["approve", "approval-1", "--reason", "preview deploy", "--json"],
      { from: "user" }
    );
    expect(JSON.parse(output[2] ?? "{}")).toMatchObject({
      path: approvalStorePath,
      request: {
        id: "approval-1",
        status: "approved",
        runtimeStatus: "approved",
        approvalGateReason: "preview deploy touches remote state",
        approvalGateRisk: "high",
        approvalGateLabels: ["remote-state", "deploy"],
        decisionReason: "preview deploy"
      }
    });
    expect(output[2]).toContain("preview deploy touches remote state");

    await program.parseAsync(
      ["--cwd", root, "approvals", "--status", "approved"],
      { from: "user" }
    );
    expect(output[3]).toContain("approval-1 approved");
    expect(output[3]).not.toContain("approval-2");

    await program.parseAsync(
      ["--cwd", root, "approvals", "--status", "expired"],
      { from: "user" }
    );
    expect(output[4]).toContain("approval-3 expired");
    expect(output[4]).not.toContain("approval-1");

    await program.parseAsync(["deny", "approval-2"], { from: "user" });
    expect(output[5]).toContain("Status: denied");

    await program.parseAsync(["--cwd", root, "approvals", "--status", "stale"], {
      from: "user"
    });
    expect(output[6]).toContain("approval-4 stale");
    expect(output[6]).not.toContain("approval-1");

    await program.parseAsync(["--cwd", root, "approvals", "--status", "weird"], {
      from: "user"
    });
    expect(errors).toEqual([
      "error: --status must be pending, approved, denied, stale, or expired"
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("lists approval requests across a mandate tree", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);
    const mandateStorePath = join(root, "state", "mandates.json");
    const approvalStorePath = join(root, "state", "approvals.json");
    const output: string[] = [];
    const program = createProgram({
      mandateStorePath,
      approvalStorePath,
      writeOut: (message) => output.push(message)
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "fix-ci",
        "--agent",
        "lead",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "2h",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "child",
        "rerun checks",
        "--parent",
        "fix-ci",
        "--agent",
        "worker",
        "--profiles",
        "github_findu",
        "--branch",
        "fix/ci",
        "--lease",
        "30m",
        "--json"
      ],
      { from: "user" }
    );

    const parent = JSON.parse(output[0] ?? "{}").mandate as {
      id: string;
      mandateUid: string;
    };
    const child = JSON.parse(output[1] ?? "{}").mandate as {
      id: string;
      mandateUid: string;
      parentMandateId: string;
      parentMandateUid: string;
      delegationPath: string[];
      delegationUids: string[];
    };
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    await createApprovalRequest({
      path: approvalStorePath,
      mandateId: parent.id,
      mandateUid: parent.mandateUid,
      repoPath: root,
      branch: "fix/ci",
      toolName: "github_findu_deploy_preview",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_deploy_preview",
      expiresAt
    });
    await createApprovalRequest({
      path: approvalStorePath,
      mandateId: child.id,
      mandateUid: child.mandateUid,
      parentMandateId: child.parentMandateId,
      parentMandateUid: child.parentMandateUid,
      delegationPath: child.delegationPath,
      delegationUids: child.delegationUids,
      repoPath: root,
      branch: "fix/ci",
      toolName: "github_findu_checks_rerun",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_checks_rerun",
      approvalGateRisk: "medium",
      expiresAt
    });
    await createApprovalRequest({
      path: approvalStorePath,
      mandateId: "fix-ci",
      mandateUid: "fix-ci:old",
      repoPath: root,
      branch: "fix/ci",
      toolName: "old_fix_ci_deploy",
      approvalGateId: "gate-1",
      approvalGatePattern: "old_fix_ci_deploy",
      expiresAt
    });
    await createApprovalRequest({
      path: approvalStorePath,
      mandateId: "fix-ci",
      repoPath: root,
      branch: "fix/ci",
      toolName: "legacy_no_uid_deploy",
      approvalGateId: "gate-2",
      approvalGatePattern: "legacy_no_uid_deploy",
      expiresAt
    });

    await program.parseAsync(
      ["--cwd", root, "approvals", "--mandate", "fix-ci", "--json"],
      { from: "user" }
    );
    await program.parseAsync(
      [
        "--cwd",
        root,
        "approvals",
        "--mandate",
        "fix-ci",
        "--include-children",
        "--json"
      ],
      { from: "user" }
    );

    expect(JSON.parse(output[2] ?? "{}")).toMatchObject({
      schemaVersion: "switchboard.approvals.v1",
      mandateStorePath,
      includeChildren: false,
      counts: {
        requests: 1
      },
      requests: [
        { mandateUid: parent.mandateUid, toolName: "github_findu_deploy_preview" }
      ]
    });
    expect(JSON.parse(output[3] ?? "{}")).toMatchObject({
      schemaVersion: "switchboard.approvals.v1",
      mandateStorePath,
      includeChildren: true,
      rootMandateId: "fix-ci",
      rootMandateUid: parent.mandateUid,
      childrenByParent: {
        "fix-ci": ["rerun-checks"]
      },
      counts: {
        requests: 2,
        pending: 2
      },
      mandates: [
        { id: "fix-ci", mandateUid: parent.mandateUid },
        {
          id: "rerun-checks",
          mandateUid: child.mandateUid,
          parentMandateUid: parent.mandateUid
        }
      ],
      requests: [
        { mandateUid: parent.mandateUid, toolName: "github_findu_deploy_preview" },
        {
          mandateUid: child.mandateUid,
          parentMandateUid: parent.mandateUid,
          delegationPath: ["fix-ci", "rerun-checks"],
          toolName: "github_findu_checks_rerun"
        }
      ]
    });
  });

  it("rejects child approval listings without a scoped parent mandate", async () => {
    const root = makeTempProject();
    const errors: string[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message)
    });

    await program.parseAsync(["--cwd", root, "approvals", "--include-children"], {
      from: "user"
    });

    expect(errors).toEqual([
      "error: --include-children requires --mandate <id>"
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("prints local audit logs as JSON", async () => {
    const root = makeTempProject();
    const logPath = join(root, "switchboard.jsonl");
    writeFileSync(
      logPath,
      [
        JSON.stringify({
          version: 1,
          timestamp: "2026-06-19T14:00:00.000Z",
          action: "profile_test",
          status: "ok",
          profileName: "one"
        }),
        JSON.stringify({
          version: 1,
          timestamp: "2026-06-19T14:01:00.000Z",
          action: "tool_call",
          status: "ok",
          profileName: "two",
          toolName: "two_echo"
        })
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      auditLogPath: logPath
    });
    await program.parseAsync(["logs", "--json", "--limit", "1"], {
      from: "user"
    });

    expect(JSON.parse(output[0] ?? "{}")).toEqual({
      path: logPath,
      mandateId: null,
      entries: [
        {
          version: 1,
          timestamp: "2026-06-19T14:01:00.000Z",
          action: "tool_call",
          status: "ok",
          profileName: "two",
          toolName: "two_echo"
        }
      ]
    });
  });

  it("filters local audit logs by mandate id", async () => {
    const root = makeTempProject();
    const logPath = join(root, "switchboard.jsonl");
    writeFileSync(
      logPath,
      [
        JSON.stringify({
          version: 1,
          timestamp: "2026-06-19T14:00:00.000Z",
          action: "tool_call",
          status: "ok",
          profileName: "one",
          mandateId: "fix-ci"
        }),
        JSON.stringify({
          version: 1,
          timestamp: "2026-06-19T14:01:00.000Z",
          action: "tool_call",
          status: "ok",
          profileName: "two",
          mandateId: "other"
        }),
        JSON.stringify({
          version: 1,
          timestamp: "2026-06-19T14:02:00.000Z",
          action: "tool_call",
          status: "ok",
          profileName: "three",
          mandateId: "fix-ci"
        })
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      auditLogPath: logPath
    });
    await program.parseAsync(
      ["logs", "--json", "--limit", "1", "--mandate", "fix-ci"],
      {
        from: "user"
      }
    );

    expect(JSON.parse(output[0] ?? "{}")).toEqual({
      path: logPath,
      mandateId: "fix-ci",
      entries: [
        {
          version: 1,
          timestamp: "2026-06-19T14:02:00.000Z",
          action: "tool_call",
          status: "ok",
          profileName: "three",
          mandateId: "fix-ci"
        }
      ]
    });
  });
});

function makeTempProject(): string {
  const root = join(
    tmpdir(),
    `switchboard-cli-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function initGitRepo(root: string, branch: string): void {
  execFileSync("git", ["init", "-b", branch], {
    cwd: root,
    stdio: "ignore"
  });
}

function writeStdioConfig(root: string): void {
  writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
  writeFileSync(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  local_echo:",
      "    provider: generic",
      "    namespace: echo_tools",
      "    upstream:",
      "      type: stdio",
      "      command: node",
      "      args:",
      "        - fixture.mjs"
    ].join("\n")
  );
}

function writeMandateConfig(root: string): void {
  writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
  writeFileSync(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic",
      "  vercel_preview:",
      "    provider: generic"
    ].join("\n")
  );
}

function writeMandateFixtureConfig(root: string): void {
  writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
  writeFileSync(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic",
      "    namespace: github_findu",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - github-findu",
      "  vercel_preview:",
      "    provider: generic",
      "    namespace: vercel_preview",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - vercel-preview"
    ].join("\n")
  );
}
