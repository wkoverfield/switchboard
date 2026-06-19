import { mkdirSync, writeFileSync } from "node:fs";
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
    expect(parsed.content).toContain(`args = ["--cwd", "${root}", "serve"]`);
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
          args: ["--cwd", root, "serve"],
          env: {}
        }
      }
    });
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
});

function makeTempProject(): string {
  const root = join(
    tmpdir(),
    `switchboard-cli-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  mkdirSync(root, { recursive: true });
  return root;
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
