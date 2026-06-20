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
import { afterEach, describe, expect, it } from "vitest";
import { createProgram } from "./program.js";

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
    const served: Array<{ socket: string; mandateId: string | undefined }> = [];
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
        served.push({ socket, mandateId: options?.mandateId });
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
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(["--cwd", root, "mcp", "--mandate", "fix-ci"], {
      from: "user"
    });

    expect(served).toEqual([{ socket: socketPath, mandateId: "fix-ci" }]);
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
    }> = [];
    const program = createProgram({
      mandateStorePath,
      writeOut: () => undefined,
      serveMcp: async (profiles, options) => {
        served.push({ profiles, mandateId: options?.mandateId });
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
        lease: "2h",
        runtimeStatus: "active"
      }
    });

    await program.parseAsync(["--cwd", root, "mandate", "status", "--json"], {
      from: "user"
    });

    expect(JSON.parse(output[1] ?? "{}")).toMatchObject({
      path: mandateStorePath,
      repoPath: root,
      mandates: [
        {
          id: "fix-ci",
          branch: "fix/ci",
          agentRole: "implementer",
          runtimeStatus: "active"
        }
      ]
    });
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
