import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createApprovalRequest,
  createMemorySecretStore,
  markApprovalRequestStale,
  type SecretStore
} from "@switchboard-mcp/core";
import { createProgram } from "./program.js";

const fixtureServerPath = fileURLToPath(
  new URL(
    "../../../packages/mcp-runtime/fixtures/echo-server.mjs",
    import.meta.url
  )
);

interface MandateStatusReadinessTestPayload {
  blockers: string[];
  nextActions: string[];
  mandates: Record<string, { blockers: string[]; nextActions: string[] }>;
}

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

  it("prints scan JSON with repo, provider hints, and no raw env values", async () => {
    const root = makeTempProject();
    initGitRepo(root, "main");
    execFileSync(
      "git",
      ["remote", "add", "origin", "https://github.com/wkoverfield/stockr.git"],
      { cwd: root, stdio: "ignore" }
    );
    mkdirSync(join(root, ".vercel"), { recursive: true });
    writeFileSync(
      join(root, ".env.local"),
      [
        "STRIPE_SECRET_KEY=sk_test_should_not_print",
        "VERCEL_TOKEN=vercel_should_not_print"
      ].join("\n")
    );
    writeFileSync(
      join(root, ".vercel", "project.json"),
      JSON.stringify({ projectId: "prj_should_not_print" })
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "scan", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      schemaVersion: string;
      repo: { remote: { owner: string; repo: string } };
      providers: Array<{ provider: string; envVars: string[] }>;
      authorityStatus: { status: string };
      recommendedNextAction: { primary: { command: string } | null };
      nextActions: string[];
    };
    const serialized = output.join("\n");
    expect(parsed.schemaVersion).toBe("switchboard.scan.v1");
    expect(parsed.repo.remote).toMatchObject({
      owner: "wkoverfield",
      repo: "stockr"
    });
    expect(parsed.providers.map((provider) => provider.provider)).toContain(
      "stripe"
    );
    expect(parsed.providers.map((provider) => provider.provider)).toContain(
      "vercel"
    );
    expect(parsed.authorityStatus.status).toBe("bypass-present");
    expect(parsed.nextActions).toContain("switchboard setup github-ci");
    expect(parsed.recommendedNextAction.primary?.command).toBe(
      "switchboard setup github-ci"
    );
    expect(serialized).not.toContain("sk_test_should_not_print");
    expect(serialized).not.toContain("vercel_should_not_print");
    expect(serialized).not.toContain("prj_should_not_print");
  });

  it("prints scan human output with high-signal next actions", async () => {
    const root = makeTempProject();
    initGitRepo(root, "main");
    execFileSync(
      "git",
      ["remote", "add", "origin", "git@github.com:wkoverfield/stockr.git"],
      { cwd: root, stdio: "ignore" }
    );
    writeFileSync(join(root, ".env.local"), "STRIPE_SECRET_KEY=secret\n");

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "scan"], {
      from: "user"
    });

    const text = output.join("\n");
    expect(text).toContain("This looks like");
    expect(text).toContain("GitHub: wkoverfield/stockr");
    expect(text).toContain("authority:");
    expect(text).toContain("Provider hints:");
    expect(text).toContain("STRIPE_SECRET_KEY");
    expect(text).toContain("Recommended next:");
    expect(text).toContain("switchboard setup github-ci");
    expect(text).toContain("switchboard install codex --write");
    expect(text).not.toContain("secret\n");
  });

  it("prints import dry-run before and after cleanup story", async () => {
    const root = makeTempProject();
    mkdirSync(join(root, ".codex"));
    writeFileSync(
      join(root, ".codex", "config.toml"),
      [
        "[mcp_servers.switchboard]",
        'command = "switchboard"',
        `args = ["--cwd", "${root}", "mcp"]`,
        "",
        "[mcp_servers.github]",
        'command = "docker"',
        'args = ["run", "GITHUB_TOKEN=ghp_import_should_not_print", "ghcr.io/github/github-mcp-server"]',
        'env = { GITHUB_TOKEN = "ghp_import_should_not_print" }'
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "import", "--dry-run"], {
      from: "user"
    });

    const text = output.join("\n");
    expect(text).toContain("Authority status: bypass-present");
    expect(text).toContain("Before:");
    expect(text).toContain("Codex github direct MCP");
    expect(text).toContain("Switchboard can change this to:");
    expect(text).toContain("direct client routes removed from active config");
    expect(text).toContain("Recommended next:");
    expect(text).not.toContain("ghp_import_should_not_print");
  });

  it("prints the recommended next action as JSON", async () => {
    const root = makeTempProject();
    initGitRepo(root, "main");
    execFileSync(
      "git",
      ["remote", "add", "origin", "git@github.com:wkoverfield/stockr.git"],
      { cwd: root, stdio: "ignore" }
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "next", "--json"], {
      from: "user"
    });

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: true,
      schemaVersion: "switchboard.next-action.v1",
      recommendedNextAction: {
        primary: {
          kind: "provider-setup",
          command: "switchboard setup github-ci"
        }
      }
    });
  });

  it("lists provider safety templates as JSON", async () => {
    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await program.parseAsync(["presets", "list", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      schemaVersion: string;
      templates: Array<{ id: string; defaultSecretRef: string }>;
    };
    expect(parsed.schemaVersion).toBe("switchboard.provider-preset.v1");
    expect(parsed.templates.map((template) => template.id)).toEqual([
      "github-ci",
      "stripe-test",
      "vercel-preview"
    ]);
    expect(parsed.templates[0]?.defaultSecretRef).toBe("github/example/dev/token");
    expect(output.join("\n")).not.toContain("ghp_");
  });

  it("shows provider safety templates with value-free config and mandate policy", async () => {
    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await program.parseAsync(
      [
        "presets",
        "show",
        "github-ci",
        "--profile-name",
        "github_findu",
        "--namespace",
        "GitHub FindU",
        "--secret-ref",
        "github/findu/dev/token",
        "--command",
        "npx",
        "--arg",
        "-y",
        "--arg",
        "@modelcontextprotocol/server-github",
        "--json"
      ],
      { from: "user" }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      schemaVersion: string;
      profileName: string;
      namespace: string;
      args: string[];
      configYaml: string;
      secretCommands: string[];
      mandateCommand: string;
      mandatePolicy: {
        allowedTools: string[];
        deniedTools: string[];
        approvalGates: Array<{ toolPattern: string; risk?: string }>;
      };
      credentialGuidance: {
        minimumScopes: string[];
        approvalScopes: string[];
        avoidScopes: string[];
      };
    };
    expect(parsed.schemaVersion).toBe("switchboard.provider-preset.v1");
    expect(parsed.profileName).toBe("github_findu");
    expect(parsed.namespace).toBe("github_findu");
    expect(parsed.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);
    expect(parsed.configYaml).toContain("secretRef: github/findu/dev/token");
    expect(parsed.configYaml).toContain("command: npx");
    expect(parsed.configYaml).toContain("- -y");
    expect(parsed.configYaml).not.toContain("ghp_");
    expect(parsed.secretCommands).toEqual([
      "switchboard secrets set github/findu/dev/token --value-stdin"
    ]);
    expect(parsed.mandateCommand).toContain("--allow-tool 'github_findu_*'");
    expect(parsed.mandateCommand).toContain(
      "--deny-tool github_findu_deploy_prod"
    );
    expect(parsed.mandateCommand).toContain("--require-approval-risk medium");
    expect(parsed.mandatePolicy.allowedTools).toEqual(["github_findu_*"]);
    expect(parsed.mandatePolicy.deniedTools).toContain(
      "github_findu_deploy_prod"
    );
    expect(parsed.mandatePolicy.approvalGates).toContainEqual(
      expect.objectContaining({
        toolPattern: "github_findu_*rerun*",
        risk: "medium"
      })
    );
    expect(parsed.credentialGuidance.minimumScopes).toContain(
      "read checks/statuses"
    );
    expect(parsed.credentialGuidance.approvalScopes).toContain(
      "rerun workflow jobs"
    );
    expect(parsed.credentialGuidance.avoidScopes).toContain("delete_repo");
  });

  it("prints human provider preset output without claiming installation", async () => {
    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await program.parseAsync(["presets", "show", "vercel-preview"], {
      from: "user"
    });

    expect(output.join("\n")).toContain(
      "Switchboard provider safety template: Vercel Preview"
    );
    expect(output.join("\n")).toContain("Config YAML:");
    expect(output.join("\n")).toContain("Rendered mandate policy:");
    expect(output.join("\n")).toContain("vercel_preview_deploy_prod");
    expect(output.join("\n")).toContain("Credential guidance:");
    expect(output.join("\n")).toContain("read deployments");
    expect(output.join("\n")).toContain("production promotion");
    expect(output.join("\n")).toContain(
      "This template does not install, authenticate, or vendor a provider MCP server."
    );
  });

  it("returns JSON errors for invalid provider preset render options", async () => {
    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await program.parseAsync(
      [
        "presets",
        "show",
        "github-ci",
        "--secret-ref",
        "Bad Secret",
        "--json"
      ],
      { from: "user" }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      schemaVersion: string;
      code: string;
      message: string;
    };
    expect(parsed.schemaVersion).toBe("switchboard.error.v1");
    expect(parsed.code).toBe("provider_preset_render_failed");
    expect(parsed.message).toContain("secretRef");
    expect(process.exitCode).toBe(1);
  });

  it("returns JSON errors for unknown provider presets", async () => {
    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await program.parseAsync(["presets", "show", "missing", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      schemaVersion: string;
      code: string;
      nextActions: string[];
    };
    expect(parsed.schemaVersion).toBe("switchboard.error.v1");
    expect(parsed.code).toBe("unknown_provider_preset");
    expect(parsed.nextActions).toContain(
      "Run switchboard presets list to see available templates."
    );
    expect(process.exitCode).toBe(1);
  });

  it("prints a provider add dry-run plan without writing", async () => {
    const root = makeTempProject();
    initGitRepo(root, "current-branch");
    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await program.parseAsync(
      ["--cwd", root, "add", "github-ci", "--dry-run", "--json"],
      {
        from: "user"
      }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      schemaVersion: string;
      action: string;
      targetPath: string;
      mandatePolicy: {
        allowedTools: string[];
        deniedTools: string[];
      };
      credentialGuidance: {
        minimumScopes: string[];
        approvalScopes: string[];
        avoidScopes: string[];
      };
      commands: {
        setup: { command: string; args: string[] };
        auth: { command: string; args: string[] };
        mandateCreate: { command: string; args: string[] };
      };
    };
    const profileName = githubRepoProfile(root);
    const secretRef = githubRepoSecretRef(root);
    expect(parsed.schemaVersion).toBe("switchboard.provider-add.v1");
    expect(parsed.action).toBe("create-planned");
    expect(parsed.targetPath).toBe(join(root, ".switchboard.yaml"));
    expect(parsed.commands.mandateCreate).toMatchObject({
      command: "switchboard",
      args: expect.arrayContaining([
        "mandate",
        "create",
        "fix-ci",
        "--from",
        "github-ci"
      ])
    });
    expect(parsed.commands.setup).toEqual({
      command: "switchboard",
      args: ["setup", "github-ci", "--secret-ref", secretRef]
    });
    expect(parsed.commands.auth).toEqual({
      command: "switchboard",
      args: ["auth", "github-ci", "--secret-ref", secretRef]
    });
    expect(parsed.mandatePolicy.allowedTools).toEqual([`${profileName}_*`]);
    expect(parsed.mandatePolicy.deniedTools).toContain(`${profileName}_deploy_prod`);
    expect(parsed.credentialGuidance.minimumScopes).toContain(
      "read checks/statuses"
    );
    expect(parsed.credentialGuidance.approvalScopes).toContain(
      "rerun workflow jobs"
    );
    expect(parsed.credentialGuidance.avoidScopes).toContain("delete_repo");
    expect(existsSync(join(root, ".switchboard.yaml"))).toBe(false);
  });

  it("prints a provider add value summary before the config preview", async () => {
    const root = makeTempProject();
    initGitRepo(root, "main");
    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await program.parseAsync(["--cwd", root, "add", "github-ci"], {
      from: "user"
    });

    const profileName = githubRepoProfile(root);
    const secretRef = githubRepoSecretRef(root);
    const text = output.join("\n");
    expect(text).toContain("What this prepares:");
    expect(text).toContain(`one github MCP profile: ${profileName}`);
    expect(text).toContain(`Token storage: local token alias ${secretRef}`);
    expect(text).toContain(
      `one local token alias for GITHUB_PERSONAL_ACCESS_TOKEN: ${secretRef}`
    );
    expect(text).toContain(
      "mandate policy: 1 allow pattern(s), 10 approval gate(s), 5 deny pattern(s)"
    );
    expect(text).toContain("Credential guidance:");
    expect(text).toContain("read checks/statuses");
    expect(text).toContain("delete_repo");
    expect(text).toContain("switchboard auth github-ci");
    expect(text).not.toContain(
      `switchboard secrets set ${secretRef} --value-stdin`
    );
    expect(text.indexOf("What this prepares:")).toBeLessThan(
      text.indexOf("Config preview:")
    );
  });

  it("uses repo-aware defaults for Stripe test provider add", async () => {
    const root = makeTempProject();
    initGitRepo(root, "main");
    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await program.parseAsync(
      ["--cwd", root, "add", "stripe-test", "--dry-run", "--json"],
      { from: "user" }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      profileName: string;
      namespace: string;
      secretRef: string;
      mandatePolicy: { deniedTools: string[]; approvalGates: unknown[] };
      credentialGuidance: { posture: string; avoidScopes: string[] };
    };
    const profileName = stripeRepoProfile(root);
    expect(parsed.profileName).toBe(profileName);
    expect(parsed.namespace).toBe(profileName);
    expect(parsed.secretRef).toBe(stripeRepoSecretRef(root));
    expect(parsed.mandatePolicy.deniedTools).toContain(`${profileName}_*live*`);
    expect(parsed.mandatePolicy.approvalGates.length).toBeGreaterThan(0);
    expect(parsed.credentialGuidance.posture).toContain("test-mode");
    expect(parsed.credentialGuidance.avoidScopes).toContain(
      "live-mode secret keys"
    );
  });

  it("prints source-checkout provider add next steps with the target repo cwd", async () => {
    const root = makeTempProject();
    const sourceRoot = join(root, "switchboard-source");
    const sourceEntrypoint = join(
      sourceRoot,
      "apps",
      "cli",
      "dist",
      "index.js"
    );
    const originalLifecycle = process.env.npm_lifecycle_event;
    const originalPackageName = process.env.npm_package_name;
    const originalArgv1 = process.argv[1];
    process.env.npm_lifecycle_event = "switchboard";
    process.env.npm_package_name = "switchboard";
    process.argv[1] = sourceEntrypoint;

    try {
      const output: string[] = [];
      const program = createProgram({
        writeOut: (message) => output.push(message)
      });
      await program.parseAsync(["--cwd", root, "add", "vercel-preview", "--write"], {
        from: "user"
      });

      const text = output.join("\n");
      expect(text).toContain(
        `pnpm --dir ${sourceRoot} switchboard --cwd ${root} auth vercel-preview`
      );
      expect(text).toContain(
        `pnpm --dir ${sourceRoot} switchboard --cwd ${root} presets check vercel-preview --profile ${vercelRepoProfile(root)}`
      );
      expect(text).not.toContain("  pnpm switchboard auth vercel-preview");
    } finally {
      restoreEnvValue("npm_lifecycle_event", originalLifecycle);
      restoreEnvValue("npm_package_name", originalPackageName);
      if (originalArgv1 === undefined) {
        process.argv.splice(1, 1);
      } else {
        process.argv[1] = originalArgv1;
      }
    }
  });

  it("prints source-checkout authority recommended actions with the target repo cwd", async () => {
    const root = makeTempProject();
    const sourceRoot = join(root, "switchboard-source");
    const sourceEntrypoint = join(
      sourceRoot,
      "apps",
      "cli",
      "dist",
      "index.js"
    );
    const originalLifecycle = process.env.npm_lifecycle_event;
    const originalPackageName = process.env.npm_package_name;
    const originalArgv1 = process.argv[1];
    process.env.npm_lifecycle_event = "switchboard";
    process.env.npm_package_name = "switchboard";
    process.argv[1] = sourceEntrypoint;
    mkdirSync(join(root, ".codex"));
    writeFileSync(
      join(root, ".codex", "config.toml"),
      [
        "[mcp_servers.switchboard]",
        'command = "switchboard"',
        `args = ["--cwd", "${root}", "mcp"]`,
        "",
        "[mcp_servers.github]",
        'command = "docker"',
        'args = ["run", "GITHUB_TOKEN=ghp_source_should_not_print", "ghcr.io/github/github-mcp-server"]'
      ].join("\n")
    );

    try {
      const output: string[] = [];
      const program = createProgram({
        writeOut: (message) => output.push(message)
      });
      await program.parseAsync(["--cwd", root, "doctor", "--json"], {
        from: "user"
      });

      const parsed = JSON.parse(output[0] ?? "{}") as {
        authorityStatus: {
          recommendedAction: { command: string; args: string[] } | null;
        };
      };
      expect(parsed.authorityStatus.recommendedAction).toEqual({
        command: "pnpm",
        args: [
          "--dir",
          sourceRoot,
          "switchboard",
          "--cwd",
          root,
          "import",
          "--write",
          "--cleanup-client"
        ]
      });
      expect(JSON.stringify(parsed)).not.toContain("ghp_source_should_not_print");
    } finally {
      restoreEnvValue("npm_lifecycle_event", originalLifecycle);
      restoreEnvValue("npm_package_name", originalPackageName);
      if (originalArgv1 === undefined) {
        process.argv.splice(1, 1);
      } else {
        process.argv[1] = originalArgv1;
      }
    }
  });

  it("prints provider auth command with custom secret ref in provider add output", async () => {
    const root = makeTempProject();
    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "add",
        "github-ci",
        "--secret-ref",
        "github/findu/dev/token"
      ],
      { from: "user" }
    );

    expect(output.join("\n")).toContain(
      "switchboard auth github-ci --secret-ref github/findu/dev/token"
    );
  });

  it("rejects conflicting provider add dry-run and write modes", async () => {
    const root = makeTempProject();
    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await program.parseAsync(
      ["--cwd", root, "add", "github-ci", "--dry-run", "--write", "--json"],
      {
        from: "user"
      }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      schemaVersion: string;
      code: string;
      message: string;
    };
    expect(parsed.schemaVersion).toBe("switchboard.error.v1");
    expect(parsed.code).toBe("conflicting_provider_add_modes");
    expect(parsed.message).toContain("--dry-run");
    expect(process.exitCode).toBe(1);
  });

  it("checks configured provider preset tools against recommended policy", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  github_findu:",
        "    provider: github",
        "    namespace: GitHub FindU",
        "    upstream:",
        "      type: stdio",
        "      command: node"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      listTools: async () => [
        namespacedTool("github_findu_checks_list"),
        namespacedTool("github_findu_checks_rerun"),
        namespacedTool("github_findu_secret_update"),
        namespacedTool("github_findu_deploy_prod")
      ]
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "presets",
        "check",
        "github-ci",
        "--profile",
        "github_findu",
        "--json"
      ],
      { from: "user" }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      schemaVersion: string;
      namespace: string;
      policyCovered: boolean;
      requiresMandatePolicy: boolean;
      counts: {
        allowed: number;
        allowedSensitive: number;
        approvalRequired: number;
        denied: number;
      };
      tools: Array<{ toolName: string; classification: string }>;
      nextActions: string[];
    };
    expect(parsed.schemaVersion).toBe("switchboard.provider-preset-check.v1");
    expect(parsed.ok).toBe(true);
    expect(parsed.policyCovered).toBe(true);
    expect(parsed.requiresMandatePolicy).toBe(true);
    expect(parsed.namespace).toBe("github_findu");
    expect(parsed.counts).toMatchObject({
      allowed: 1,
      allowedSensitive: 0,
      approvalRequired: 2,
      denied: 1
    });
    expect(parsed.tools).toMatchObject([
      { toolName: "github_findu_checks_list", classification: "allowed" },
      {
        toolName: "github_findu_checks_rerun",
        classification: "approval_required"
      },
      {
        toolName: "github_findu_secret_update",
        classification: "approval_required"
      },
      { toolName: "github_findu_deploy_prod", classification: "denied" }
    ]);
    expect(parsed.nextActions).not.toContain(
      "Review allowed sensitive-looking tools and add deny or approval patterns before using this preset for unattended work."
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("reports OK provider preset checks when observed tools are covered", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  github_ci:",
        "    provider: github",
        "    namespace: github_ci",
        "    upstream:",
        "      type: stdio",
        "      command: node"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      listTools: async () => [
        namespacedTool("github_ci_checks_list"),
        namespacedTool("github_ci_repo_read")
      ]
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "presets",
        "check",
        "github-ci",
        "--profile",
        "github_ci",
        "--json"
      ],
      { from: "user" }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      policyCovered: boolean;
      requiresMandatePolicy: boolean;
      counts: { allowed: number; allowedSensitive: number };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.policyCovered).toBe(true);
    expect(parsed.requiresMandatePolicy).toBe(false);
    expect(parsed.counts).toMatchObject({
      allowed: 2,
      allowedSensitive: 0
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("passes provider preset check timeout to tool discovery", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  github_ci:",
        "    provider: github",
        "    namespace: github_ci",
        "    upstream:",
        "      type: stdio",
        "      command: node"
      ].join("\n")
    );

    const seenTimeouts: Array<number | undefined> = [];
    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      listTools: async (_profiles, options) => {
        seenTimeouts.push(options?.timeoutMs);
        return [namespacedTool("github_ci_checks_list")];
      }
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "presets",
        "check",
        "github-ci",
        "--profile",
        "github_ci",
        "--timeout-ms",
        "60000",
        "--json"
      ],
      { from: "user" }
    );

    expect(seenTimeouts).toEqual([60000]);
    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      schemaVersion: "switchboard.provider-preset-check.v1"
    });
  });

  it("rejects invalid provider preset check timeouts", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".switchboard.yaml"), "version: 1\nprofiles: {}\n");

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "presets",
        "check",
        "github-ci",
        "--profile",
        "github_ci",
        "--timeout-ms",
        "0",
        "--json"
      ],
      { from: "user" }
    );

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      code: "invalid_timeout",
      message: "--timeout-ms must be a positive integer"
    });
    expect(process.exitCode).toBe(1);
  });

  it("rejects provider preset checks against the wrong provider profile", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  vercel_preview:",
        "    provider: vercel",
        "    namespace: vercel_preview",
        "    upstream:",
        "      type: stdio",
        "      command: node"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "presets",
        "check",
        "github-ci",
        "--profile",
        "vercel_preview",
        "--json"
      ],
      { from: "user" }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      code: string;
      message: string;
    };
    expect(parsed.code).toBe("provider_preset_profile_mismatch");
    expect(parsed.message).toContain('expects provider "github"');
    expect(process.exitCode).toBe(1);
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
      status: string;
      nextSteps: string[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("setup-incomplete");
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
      status: string;
      nextSteps: string[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("setup-incomplete");
    expect(parsed.nextSteps).toEqual([
      "switchboard test local_echo",
      "switchboard install codex --write",
      "switchboard install claude --write"
    ]);
  });

  it("prints provider template next steps for a ready GitHub profile", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  github_ci:",
        "    provider: github",
        "    namespace: github_ci",
        "    upstream:",
        "      type: stdio",
        "      command: node",
        "      args:",
        "        - fixture.mjs"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      status: string;
      nextSteps: string[];
    };
    expect(parsed.status).toBe("setup-incomplete");
    expect(parsed.nextSteps).toContain(
      "switchboard presets check github-ci --profile github_ci"
    );
    expect(parsed.nextSteps).toContain("switchboard mandate create --from github-ci");
    expect(parsed.nextSteps.indexOf("switchboard test github_ci")).toBeLessThan(
      parsed.nextSteps.indexOf("switchboard mandate create --from github-ci")
    );
  });

  it("reports missing secret refs in doctor without printing values", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  github_findu:",
        "    provider: generic",
        "    upstream:",
        "      type: stdio",
        "      command: node",
        "      env:",
        "        GITHUB_TOKEN:",
        "          secretRef: github/findu/dev/token"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({
      secretStore: createMemorySecretStore(),
      writeOut: (message) => output.push(message)
    });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      checks: Array<{ name: string; ok: boolean }>;
      nextSteps: string[];
      secrets: { missing: Array<{ ref: string; message: string }> };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.checks.find((check) => check.name === "secrets")).toMatchObject({
      ok: false
    });
    expect(parsed.secrets.missing).toMatchObject([
      { ref: "github/findu/dev/token" }
    ]);
    expect(parsed.nextSteps).toContain(
      "switchboard secrets set github/findu/dev/token --value-stdin"
    );
    expect(JSON.stringify(parsed)).not.toContain("ghp_secret");
  });

  it("suggests provider auth for missing provider preset secrets", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  github_ci:",
        "    provider: github",
        "    upstream:",
        "      type: stdio",
        "      command: node",
        "      env:",
        "        GITHUB_PERSONAL_ACCESS_TOKEN:",
        "          secretRef: github/example/dev/token"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({
      secretStore: createMemorySecretStore(),
      writeOut: (message) => output.push(message)
    });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      nextSteps: string[];
    };
    expect(parsed.nextSteps).toContain("switchboard auth github-ci");
  });

  it("returns JSON error envelopes when runtime commands hit missing secret refs", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(join(root, ".switchboard.yaml"), secretRefProfileYaml());

    const output: string[] = [];
    const program = createProgram({
      secretStore: createMemorySecretStore(),
      writeOut: (message) => output.push(message)
    });
    await program.parseAsync(["--cwd", root, "tools", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      code: string;
      message: string;
      nextActions: string[];
    };
    expect(parsed).toMatchObject({
      ok: false,
      code: "secret_resolution_failed"
    });
    expect(parsed.message).toContain('secretRef "github/findu/dev/token"');
    expect(parsed.nextActions).toContain(
      "switchboard secrets set github/findu/dev/token --value-stdin"
    );
    expect(output.join("\n")).not.toContain("ghp_secret");
  });

  it("reports missing secret refs before testing a profile", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(join(root, ".switchboard.yaml"), secretRefProfileYaml());

    const output: string[] = [];
    const program = createProgram({
      secretStore: createMemorySecretStore(),
      writeOut: (message) => output.push(message)
    });
    await program.parseAsync(
      ["--cwd", root, "test", "github_findu", "--json"],
      { from: "user" }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as { code: string };
    expect(parsed.code).toBe("secret_resolution_failed");
  });

  it("reports missing secret refs before serving profiles", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(join(root, ".switchboard.yaml"), secretRefProfileYaml());

    const errors: string[] = [];
    const program = createProgram({
      secretStore: createMemorySecretStore(),
      writeErr: (message) => errors.push(message),
      serveMcp: async () => {
        throw new Error("serve should not start");
      }
    });
    await program.parseAsync(["--cwd", root, "serve"], { from: "user" });

    expect(errors.join("\n")).toContain('secretRef "github/findu/dev/token"');
  });

  it("prints config diagnostics in secrets doctor", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  github_findu:",
        "    provider: generic",
        "    upstream:",
        "      type: stdio",
        "      command: node",
        "      env:",
        "        GITHUB_TOKEN:",
        "          secretRef: Bad Secret"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({
      secretStore: createMemorySecretStore(),
      writeOut: (message) => output.push(message)
    });
    await program.parseAsync(["--cwd", root, "secrets", "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      diagnostics: Array<{ message: string }>;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.diagnostics[0]?.message).toContain("secretRef");
  });

  it("fails secrets doctor when the secret backend reports unavailable", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");

    const secretStore: SecretStore = {
      async get() {
        return null;
      },
      async set() {},
      async delete() {},
      async diagnose() {
        return { ok: false, message: "unsafe backend rejected" };
      }
    };
    const output: string[] = [];
    const program = createProgram({
      secretStore,
      writeOut: (message) => output.push(message)
    });

    await program.parseAsync(["--cwd", root, "secrets", "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      backend: { message: string };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.backend.message).toContain("unsafe backend rejected");
  });

  it("sets, lists, and removes secret refs without printing values", async () => {
    const root = makeTempProject();
    const output: string[] = [];
    const store = createMemorySecretStore();
    const program = createProgram({
      secretStore: store,
      secretIndexPath: join(root, "state", "secrets", "index.json"),
      readSecretFromStdin: async () => "ghp_secret",
      writeOut: (message) => output.push(message)
    });

    await program.parseAsync(
      ["secrets", "set", "github/findu/dev/token", "--value-stdin", "--json"],
      { from: "user" }
    );
    await program.parseAsync(["secrets", "list", "--json"], { from: "user" });
    await program.parseAsync(
      ["secrets", "remove", "github/findu/dev/token", "--json"],
      { from: "user" }
    );

    expect(await store.get("github/findu/dev/token")).toBeNull();
    const setResult = JSON.parse(output[0] ?? "{}") as { ref: string };
    const listResult = JSON.parse(output[1] ?? "{}") as {
      refs: Array<{ ref: string }>;
    };
    const removeResult = JSON.parse(output[2] ?? "{}") as { ref: string };
    expect(setResult.ref).toBe("github/findu/dev/token");
    expect(listResult.refs).toEqual([
      expect.objectContaining({ ref: "github/findu/dev/token" })
    ]);
    expect(removeResult.ref).toBe("github/findu/dev/token");
    expect(output.join("\n")).not.toContain("ghp_secret");
  });

  it("stores provider preset auth without requiring users to know the secret ref", async () => {
    const root = makeTempProject();
    const output: string[] = [];
    const prompts: string[] = [];
    const store = createMemorySecretStore();
    const program = createProgram({
      secretStore: store,
      secretIndexPath: join(root, "state", "secrets", "index.json"),
      readSecretFromPrompt: async (prompt) => {
        prompts.push(prompt);
        return "ghp_secret";
      },
      writeOut: (message) => output.push(message),
      writeErr: () => {
        throw new Error("human auth should not write manual stdin instructions");
      }
    });

    await program.parseAsync(["--cwd", root, "auth", "github-ci"], { from: "user" });

    expect(await store.get(githubRepoSecretRef(root))).toBe("ghp_secret");
    expect(prompts).toEqual([
      "Paste GitHub CI token for GITHUB_PERSONAL_ACCESS_TOKEN: "
    ]);
    expect(output.join("\n")).toContain("Stored GitHub CI token");
    expect(output.join("\n")).toContain("switchboard doctor");
    expect(output.join("\n")).toContain(
      `switchboard presets check github-ci --profile ${githubRepoProfile(root)}`
    );
    expect(output.join("\n")).not.toContain("ghp_secret");
  });

  it("stores provider preset auth as JSON for scripts", async () => {
    const root = makeTempProject();
    const output: string[] = [];
    const errors: string[] = [];
    const store = createMemorySecretStore();
    const program = createProgram({
      secretStore: store,
      secretIndexPath: join(root, "state", "secrets", "index.json"),
      readSecretFromStdin: async () => "vercel_secret",
      writeOut: (message) => output.push(message),
      writeErr: (message) => errors.push(message)
    });

    await program.parseAsync(
      [
        "auth",
        "vercel-preview",
        "--secret-ref",
        "vercel/findu/preview/token",
        "--value-stdin",
        "--json"
      ],
      { from: "user" }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      action: string;
      presetId: string;
      ref: string;
      nextSteps: string[];
    };
    expect(parsed.action).toBe("auth");
    expect(parsed.presetId).toBe("vercel-preview");
    expect(parsed.ref).toBe("vercel/findu/preview/token");
    expect(parsed.nextSteps).toContain("switchboard doctor");
    expect(await store.get("vercel/findu/preview/token")).toBe("vercel_secret");
    expect(errors).toEqual([]);
    expect(output.join("\n")).not.toContain("vercel_secret");
  });

  it("runs guided provider setup without exposing the token", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    const output: string[] = [];
    const prompts: string[] = [];
    const store = createMemorySecretStore();
    const program = createProgram({
      secretStore: store,
      secretIndexPath: join(root, "state", "secrets", "index.json"),
      readSecretFromPrompt: async (prompt) => {
        prompts.push(prompt);
        return "ghp_secret";
      },
      writeOut: (message) => output.push(message)
    });

    await program.parseAsync(["--cwd", root, "setup", "github-ci"], {
      from: "user"
    });

    expect(existsSync(join(root, ".switchboard.yaml"))).toBe(true);
    expect(await store.get(githubRepoSecretRef(root))).toBe("ghp_secret");
    expect(prompts).toEqual([
      "Paste GitHub CI token for GITHUB_PERSONAL_ACCESS_TOKEN: "
    ]);
    const text = output.join("\n");
    expect(text).toContain("Switchboard GitHub CI setup complete");
    expect(text).toContain("Ready: profile created and provider token stored locally.");
    expect(text).toContain("Token: stored locally for GitHub CI");
    expect(text).toContain(`Token alias: ${githubRepoSecretRef(root)}`);
    expect(text).toContain("switchboard doctor");
    expect(text).toContain(
      `switchboard presets check github-ci --profile ${githubRepoProfile(root)}`
    );
    expect(text).toContain("switchboard mandate create fix-ci --from github-ci");
    expect(text).not.toContain("ghp_secret");
  });

  it("runs guided provider setup as JSON for scripts", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    const output: string[] = [];
    const store = createMemorySecretStore();
    const program = createProgram({
      secretStore: store,
      secretIndexPath: join(root, "state", "secrets", "index.json"),
      readSecretFromStdin: async () => "vercel_secret",
      writeOut: (message) => output.push(message)
    });

    await program.parseAsync(
      ["--cwd", root, "setup", "vercel-preview", "--value-stdin", "--json"],
      { from: "user" }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      action: string;
      presetId: string;
      tokenStored: boolean;
      nextSteps: string[];
    };
    expect(parsed.action).toBe("setup");
    expect(parsed.presetId).toBe("vercel-preview");
    expect(parsed.tokenStored).toBe(true);
    expect(parsed.nextSteps).toContain("switchboard doctor");
    expect(await store.get(vercelRepoSecretRef(root))).toBe("vercel_secret");
    expect(output.join("\n")).not.toContain("vercel_secret");
  });

  it("runs guided Stripe test setup with repo-aware secret storage", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    const output: string[] = [];
    const store = createMemorySecretStore();
    const program = createProgram({
      secretStore: store,
      secretIndexPath: join(root, "state", "secrets", "index.json"),
      readSecretFromStdin: async () => "sk_test_secret",
      writeOut: (message) => output.push(message)
    });

    await program.parseAsync(
      ["--cwd", root, "setup", "stripe-test", "--value-stdin", "--json"],
      { from: "user" }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      action: string;
      presetId: string;
      tokenStored: boolean;
      nextSteps: string[];
    };
    expect(parsed.action).toBe("setup");
    expect(parsed.presetId).toBe("stripe-test");
    expect(parsed.tokenStored).toBe(true);
    expect(parsed.nextSteps).toContain(
      `switchboard presets check stripe-test --profile ${stripeRepoProfile(root)}`
    );
    expect(parsed.nextSteps.some((step) =>
      step.includes("switchboard mandate create inspect-test-payments") &&
      step.includes(stripeRepoProfile(root))
    )).toBe(true);
    expect(await store.get(stripeRepoSecretRef(root))).toBe("sk_test_secret");
    expect(output.join("\n")).not.toContain("sk_test_secret");
  });

  it("does not include raw secrets in generated client config", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  github_findu:",
        "    provider: generic",
        "    upstream:",
        "      type: stdio",
        "      command: node",
        "      env:",
        "        GITHUB_TOKEN:",
        "          secretRef: github/findu/dev/token"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({
      secretStore: createMemorySecretStore({
        "github/findu/dev/token": "ghp_secret"
      }),
      writeOut: (message) => output.push(message)
    });
    await program.parseAsync(["--cwd", root, "install", "codex", "--json"], {
      from: "user"
    });

    expect(output[0]).not.toContain("ghp_secret");
    expect(output[0]).not.toContain("github/findu/dev/token");
  });

  it("reports installed project client configs in doctor JSON", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);
    const binDir = join(root, "bin");
    mkdirSync(binDir);
    writeFileSync(join(binDir, "switchboard"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(binDir, "switchboard"), 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}${process.platform === "win32" ? ";" : ":"}${originalPath ?? ""}`;

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
      status: string;
      clientConfigs: Array<{ client: string; status: string }>;
      nextSteps: string[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("ok");
    expect(parsed.clientConfigs).toEqual([
      expect.objectContaining({ client: "codex", status: "installed" }),
      expect.objectContaining({ client: "claude", status: "installed" })
    ]);
    expect(parsed.nextSteps).toEqual(["switchboard test local_echo"]);
    process.env.PATH = originalPath;
  });

  it("prints a human doctor readiness summary without leading with internal refs", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  github_ci:",
        "    provider: github",
        "    upstream:",
        "      type: stdio",
        "      command: node",
        "      env:",
        "        GITHUB_PERSONAL_ACCESS_TOKEN:",
        "          secretRef: github/example/dev/token"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({
      secretStore: createMemorySecretStore({
        "github/example/dev/token": "ghp_secret"
      }),
      writeOut: (message) => output.push(message)
    });
    await program.parseAsync(["--cwd", root, "doctor"], {
      from: "user"
    });

    const text = output.join("\n");
    expect(text).toContain("Switchboard doctor:");
    expect(text).toContain("Almost ready: config is valid");
    expect(text).toContain("Agent clients:");
    expect(text).toContain("Local tokens:");
    expect(text).toContain(
      "github_ci.GITHUB_PERSONAL_ACCESS_TOKEN: set (stored as github/example/dev/token)"
    );
    expect(text).toContain("Configured local tokens are available.");
    expect(text).not.toContain("Secret refs:");
    expect(text).not.toContain("Configured secretRefs are available.");
    expect(text).not.toContain("ghp_secret");
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

  it("fails doctor when direct MCP bypass routes coexist with Switchboard", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);
    mkdirSync(join(root, ".codex"));
    writeFileSync(
      join(root, ".codex", "config.toml"),
      [
        "[mcp_servers.switchboard]",
        'command = "switchboard"',
        `args = ["--cwd", "${root}", "mcp"]`,
        "",
        "[mcp_servers.github]",
        'command = "docker"',
        'args = ["run", "GITHUB_TOKEN=ghp_doctor_should_not_print", "ghcr.io/github/github-mcp-server"]',
        'env = { GITHUB_TOKEN = "ghp_doctor_should_not_print" }'
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["--cwd", root, "doctor", "--json"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      ok: boolean;
      status: string;
      checks: Array<{ name: string; ok: boolean }>;
      bypassFindings: Array<{
        id: string;
        severity: string;
        riskTags: string[];
      }>;
      authorityStatus: { status: string };
      nextSteps: string[];
    };
    const serialized = JSON.stringify(parsed);

    expect(parsed.ok).toBe(false);
    expect(parsed.status).toBe("failed");
    expect(parsed.authorityStatus.status).toBe("bypass-present");
    expect(parsed.checks).toContainEqual(
      expect.objectContaining({ name: "direct-mcp-bypass", ok: false })
    );
    expect(parsed.bypassFindings).toContainEqual(
      expect.objectContaining({
        id: "codex:github",
        severity: "high",
        riskTags: expect.arrayContaining([
          "switchboard-coexists",
          "secret-env-name",
          "token-like-arg"
        ])
      })
    );
    expect(parsed.nextSteps).toContain("switchboard import --dry-run");
    expect(serialized).not.toContain("ghp_doctor_should_not_print");
  });

  it("runs a fixture command with mandate-scoped secretRef env and audit", async () => {
    const root = makeTempProject();
    initGitRepo(root, "main");
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  fixture_profile:",
        "    provider: fixture",
        "    upstream:",
        "      type: stdio",
        "      command: fixture",
        "      env:",
        "        FIXTURE_TOKEN:",
        "          secretRef: fixture/demo/dev/token",
        "        RAW_ENV: raw_should_not_be_injected"
      ].join("\n")
    );
    const fixturePath = join(root, "fixture");
    writeFileSync(
      fixturePath,
      [
        "#!/bin/sh",
        "has=false",
        "[ -n \"$FIXTURE_TOKEN\" ] && has=true",
        "raw=null",
        "[ -n \"$RAW_ENV\" ] && raw='\"present\"'",
        "path=null",
        "[ -n \"$PATH\" ] && path='\"present\"'",
        "printf '{\"argv\":[\"%s\"],\"hasToken\":%s,\"rawEnv\":%s,\"pathEnv\":%s}\\n' \"$1\" \"$has\" \"$raw\" \"$path\""
      ].join("\n")
    );
    chmodSync(fixturePath, 0o755);
    const mandateStorePath = join(root, "state", "mandates.json");
    const auditEntries: unknown[] = [];
    const output: string[] = [];
    const program = createProgram({
      mandateStorePath,
      secretStore: createMemorySecretStore({
        "fixture/demo/dev/token": "fixture_secret_should_not_print"
      }),
      auditLogger: {
        async log(entry) {
          auditEntries.push(entry);
        }
      },
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
        "implementer",
        "--profiles",
        "fixture_profile",
        "--branch",
        "main",
        "--lease",
        "2h"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      [
        "--cwd",
        root,
        "run",
        "--mandate",
        "fix-ci",
        "--json",
        fixturePath,
        "read"
      ],
      { from: "user" }
    );

    const parsed = JSON.parse(output[1] ?? "{}") as {
      ok: boolean;
      envKeys: string[];
      stdout: string;
    };
    const child = JSON.parse(parsed.stdout) as {
      argv: string[];
      hasToken: boolean;
      rawEnv: string | null;
      pathEnv: string | null;
    };
    const serialized = JSON.stringify({ parsed, auditEntries });

    expect(parsed.ok).toBe(true);
    expect(parsed.envKeys).toEqual(["FIXTURE_TOKEN"]);
    expect(child).toEqual({
      argv: ["read"],
      hasToken: true,
      rawEnv: null,
      pathEnv: "present"
    });
    expect(auditEntries).toContainEqual(
      expect.objectContaining({
        action: "command_run",
        status: "ok",
        mandateId: "fix-ci",
        command: fixturePath,
        args: ["read"],
        envKeys: ["FIXTURE_TOKEN"],
        exitCode: 0
      })
    );
    expect(serialized).not.toContain("fixture_secret_should_not_print");
    expect(serialized).not.toContain("raw_should_not_be_injected");
  });

  it("denies shell wrappers in run mode by default", async () => {
    const root = makeTempProject();
    initGitRepo(root, "main");
    writeMandateConfig(root);
    const mandateStorePath = join(root, "state", "mandates.json");
    const output: string[] = [];
    const program = createProgram({
      mandateStorePath,
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
        "implementer",
        "--profiles",
        "github_findu",
        "--branch",
        "main",
        "--lease",
        "2h"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      [
        "--cwd",
        root,
        "run",
        "--mandate",
        "fix-ci",
        "--json",
        "--",
        "bash",
        "-c",
        "echo hi"
      ],
      { from: "user" }
    );

    expect(JSON.parse(output[1] ?? "{}")).toMatchObject({
      ok: false,
      code: "run_command_denied"
    });
    expect(process.exitCode).toBe(1);
  });

  it("reports installed client configs with missing launch commands", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);

    await createProgram().parseAsync(
      [
        "--cwd",
        root,
        "install",
        "claude",
        "--write",
        "--command",
        join(root, "missing-switchboard")
      ],
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
      status: string;
      checks: Array<{ name: string; ok: boolean }>;
      clientConfigs: Array<{ client: string; status: string }>;
      clientLaunches: Array<{ client: string; ok: boolean; command: string }>;
      nextSteps: string[];
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.status).toBe("failed");
    expect(parsed.checks).toContainEqual(
      expect.objectContaining({ name: "client-launch", ok: false })
    );
    expect(parsed.clientConfigs).toContainEqual(
      expect.objectContaining({ client: "claude", status: "installed" })
    );
    expect(parsed.clientLaunches).toContainEqual(
      expect.objectContaining({
        client: "claude",
        ok: false,
        command: join(root, "missing-switchboard")
      })
    );
    expect(parsed.nextSteps).toContain(
      `make ${join(root, "missing-switchboard")} executable, then rerun switchboard install claude --write`
    );
  });

  it("points missing packaged launch commands to the npm install", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);
    mkdirSync(join(root, ".codex"));
    writeFileSync(
      join(root, ".codex", "config.toml"),
      [
        '[mcp_servers."switchboard"]',
        'command = "switchboard"',
        `args = ["--cwd", "${root}", "mcp"]`
      ].join("\n")
    );

    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const output: string[] = [];
      const program = createProgram({
        writeOut: (message) => output.push(message)
      });
      await program.parseAsync(["--cwd", root, "doctor", "--json"], {
        from: "user"
      });

      const parsed = JSON.parse(output[0] ?? "{}") as {
        ok: boolean;
        clientLaunches: Array<{ client: string; ok: boolean; command: string }>;
        nextSteps: string[];
      };
      expect(parsed.ok).toBe(false);
      expect(parsed.clientLaunches).toContainEqual(
        expect.objectContaining({
          client: "codex",
          ok: false,
          command: "switchboard"
        })
      );
      expect(parsed.nextSteps).toContain(
        "install Switchboard with npm install -g @switchboard-mcp/cli, then rerun switchboard install codex --write"
      );
    } finally {
      restoreEnvValue("PATH", originalPath);
    }
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

  it("applies per-gate approval labels without leaking labels across gates", async () => {
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
        "echo changes remote state",
        "--require-approval-risk",
        "medium",
        "--require-approval-labels",
        "github,write",
        "--require-approval-tool",
        "github_findu_whoami",
        "--require-approval-reason",
        "copilot delegation",
        "--require-approval-risk",
        "high",
        "--require-approval-labels",
        "github,copilot,write",
        "--json"
      ],
      { from: "user" }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      mandate: {
        approvalGates: Array<{ labels?: string[] }>;
      };
    };

    expect(parsed.mandate.approvalGates[0]?.labels).toEqual([
      "github",
      "write"
    ]);
    expect(parsed.mandate.approvalGates[1]?.labels).toEqual([
      "github",
      "copilot",
      "write"
    ]);
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

  it("scopes missing secret refs to mandate-mounted profiles in tool discovery", async () => {
    const root = makeTempProject();
    const mandateStorePath = join(root, "state", "mandates.json");
    writeMandateSecretConfig(root);

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath,
      secretStore: createMemorySecretStore({
        "github/findu/dev/token": "ghp_secret"
      })
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
    await program.parseAsync(
      ["--cwd", root, "tools", "--mandate", "fix-ci", "--json"],
      { from: "user" }
    );

    expect(JSON.parse(output[1] ?? "{}")).toMatchObject({
      schemaVersion: "switchboard.tool-surface.v1",
      ok: true,
      mandate: { id: "fix-ci" },
      profileCount: 1
    });
    expect(output[1]).not.toContain("vercel/preview/token");
    expect(output[1]).not.toContain("ghp_secret");
  });

  it("reports only mounted profile missing secret refs in mandate tool errors", async () => {
    const root = makeTempProject();
    const mandateStorePath = join(root, "state", "mandates.json");
    writeMandateSecretConfig(root);

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath,
      secretStore: createMemorySecretStore({
        "vercel/preview/token": "vercel_secret"
      })
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
    await program.parseAsync(
      ["--cwd", root, "tools", "--mandate", "fix-ci", "--json"],
      { from: "user" }
    );

    expect(JSON.parse(output[1] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "secret_resolution_failed",
      message: expect.stringContaining('secretRef "github/findu/dev/token"')
    });
    expect(output[1]).not.toContain("vercel/preview/token");
    expect(output[1]).not.toContain("vercel_secret");
  });

  it("prints next commands for human mandate tool discovery", async () => {
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
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(["--cwd", root, "tools", "--mandate", "fix-ci"], {
      from: "user"
    });

    expect(output[1]).toContain("Switchboard tools");
    expect(output[1]).toContain("Mandate: fix-ci (active)");
    expect(output[1]).toContain("Next commands:");
    expect(output[1]).toContain(
      `switchboard --cwd '${root}' mcp --mandate fix-ci`
    );
    expect(output[1]).toContain(
      `switchboard --cwd '${root}' approvals --mandate fix-ci --json`
    );
    expect(output[1]).toContain(
      `switchboard --cwd '${root}' logs --mandate fix-ci --json`
    );
    expect(output[1]).toContain(
      `switchboard --cwd '${root}' mandate handoff fix-ci --state completed --summary <summary>`
    );
  });

  it("prints a local mandate demo command sequence", async () => {
    const root = makeTempProject();
    initGitRepo(root, "demo-branch");
    writeStdioConfig(root);

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message)
    });
    await program.parseAsync(
      ["--cwd", root, "demo", "mandate", "--task", "demo-ci"],
      { from: "user" }
    );

    expect(output[0]).toContain("Switchboard mandate demo");
    expect(output[0]).toContain(`Repo: ${root}`);
    expect(output[0]).toContain("Profile: local_echo");
    expect(output[0]).toContain("Namespace: echo_tools");
    expect(output[0]).toContain("Mandate id: demo-ci");
    expect(output[0]).toContain(
      `switchboard --cwd '${root}' mandate create 'demo-ci' --agent 'implementer' --profiles 'local_echo' --branch 'demo-branch' --lease '30m' --allow-tool 'echo_tools_*' --require-approval-tool 'echo_tools_echo'`
    );
    expect(output[0]).toContain(
      `switchboard --cwd '${root}' tools --mandate demo-ci`
    );
    expect(output[0]).toContain(
      `switchboard --cwd '${root}' mcp --mandate demo-ci`
    );
    expect(output[0]).toContain(
      `switchboard --cwd '${root}' approvals --mandate demo-ci`
    );
    expect(output[0]).toContain(
      "pnpm --filter @switchboard-mcp/cli switchboard"
    );
    expect(output[0]).toContain(
      "Replace the installed CLI prefix in the commands above"
    );
    expect(output[0]).toContain("pnpm smoke:mandate-walkthrough");
  });

  it("fails mandate demo for missing stdio profile", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);

    const errors: string[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message)
    });
    await program.parseAsync(["--cwd", root, "demo", "mandate", "missing"], {
      from: "user"
    });

    expect(errors).toEqual(['error: stdio profile "missing" was not found']);
    expect(process.exitCode).toBe(1);
  });

  it("fails mandate demo for tasks with empty normalized ids", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);

    const errors: string[] = [];
    const program = createProgram({
      writeErr: (message) => errors.push(message)
    });
    await program.parseAsync(
      ["--cwd", root, "demo", "mandate", "--task", "!!!"],
      { from: "user" }
    );

    expect(errors).toEqual([
      "error: --task must contain at least one letter or number"
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("prints tool surface JSON errors to stdout", async () => {
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

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message)
    });

    await program.parseAsync(["--cwd", root, "tools", "--json"], {
      from: "user"
    });

    expect(JSON.parse(output[0] ?? "{}")).toEqual({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "no_stdio_profiles",
      message: "no stdio upstream profiles are configured",
      nextActions: [
        "Add at least one generic stdio profile to Switchboard config."
      ]
    });
    expect(process.exitCode).toBe(1);
  });

  it("prints tool surface config JSON errors to stdout", async () => {
    const root = makeTempProject();
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  alpha-tools:",
        "    provider: generic",
        "    namespace: alpha_tools",
        "    upstream:",
        "      type: stdio",
        "      command: node",
        "  alpha_tools:",
        "    provider: generic",
        "    namespace: alpha_tools",
        "    upstream:",
        "      type: stdio",
        "      command: node"
      ].join("\n")
    );

    const output: string[] = [];
    const errors: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      writeErr: (message) => errors.push(message)
    });

    await program.parseAsync(["--cwd", root, "tools", "--json"], {
      from: "user"
    });

    expect(errors).toEqual([]);
    expect(JSON.parse(output[0] ?? "{}")).toEqual({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "namespace_collision",
      message:
        'namespace "alpha_tools" is used by profiles: alpha-tools, alpha_tools',
      nextActions: ["Run switchboard doctor for config diagnostics."]
    });
    expect(process.exitCode).toBe(1);
  });

  it("prints tool surface human errors to stderr", async () => {
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
    const program = createProgram({
      writeErr: (message) => errors.push(message)
    });

    await program.parseAsync(["--cwd", root, "tools"], {
      from: "user"
    });

    expect(errors).toEqual(["error: no stdio upstream profiles are configured"]);
    expect(process.exitCode).toBe(1);
  });

  it("prints missing mandate tool surface JSON errors to stdout", async () => {
    const root = makeTempProject();
    writeMandateFixtureConfig(root);
    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath: join(root, "state", "mandates.json")
    });

    await program.parseAsync(
      ["--cwd", root, "tools", "--mandate", "missing", "--json"],
      { from: "user" }
    );

    expect(JSON.parse(output[0] ?? "{}")).toEqual({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "mandate_not_found",
      message: `mandate "missing" was not found for ${root}`,
      nextActions: ["Run switchboard mandate status to list mandates for this repo."]
    });
    expect(process.exitCode).toBe(1);
  });

  it("prints tool surface list failures to stdout under JSON", async () => {
    const root = makeTempProject();
    writeMandateFixtureConfig(root);
    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      listTools: async () => {
        throw new Error("upstream unavailable");
      }
    });

    await program.parseAsync(["--cwd", root, "tools", "--json"], {
      from: "user"
    });

    expect(JSON.parse(output[0] ?? "{}")).toEqual({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "tool_surface_failed",
      message: "upstream unavailable",
      nextActions: []
    });
    expect(process.exitCode).toBe(1);
  });

  it("prints parser errors for tool surface JSON commands to stdout", async () => {
    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message)
    });

    await expect(
      program.parseAsync(["tools", "--json", "--bogus"], {
        from: "user"
      })
    ).rejects.toThrow();

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "unknown_option",
      message: "unknown option '--bogus'"
    });
  });

  it("prints missing-value parser errors for tool surface JSON commands to stdout", async () => {
    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message)
    });

    await expect(
      program.parseAsync(["tools", "--json", "--mandate"], {
        from: "user"
      })
    ).rejects.toThrow();

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "invalid_command",
      message: "option '--mandate <id>' argument missing"
    });
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

  it("uses the source checkout entrypoint for install snippets run through pnpm switchboard", async () => {
    const root = makeTempProject();
    writeStdioConfig(root);
    const originalLifecycle = process.env.npm_lifecycle_event;
    const originalPackageName = process.env.npm_package_name;
    const originalArgv1 = process.argv[1];
    const sourceEntrypoint = join(
      root,
      "switchboard",
      "apps",
      "cli",
      "dist",
      "index.js"
    );
    process.env.npm_lifecycle_event = "switchboard";
    process.env.npm_package_name = "switchboard";
    process.argv[1] = sourceEntrypoint;

    try {
      const output: string[] = [];
      const program = createProgram({
        writeOut: (message) => output.push(message)
      });
      await program.parseAsync(["--cwd", root, "install", "claude", "--json"], {
        from: "user"
      });

      const parsed = JSON.parse(output[0] ?? "{}") as {
        content: string;
      };
      expect(JSON.parse(parsed.content)).toEqual({
        mcpServers: {
          switchboard: {
            command: process.execPath,
            args: [sourceEntrypoint, "--cwd", root, "mcp"],
            env: {}
          }
        }
      });
    } finally {
      restoreEnvValue("npm_lifecycle_event", originalLifecycle);
      restoreEnvValue("npm_package_name", originalPackageName);
      if (originalArgv1 === undefined) {
        process.argv.splice(1, 1);
      } else {
        process.argv[1] = originalArgv1;
      }
    }
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
        runtimeDir: null,
        env: {},
        approvalWaitMs: 0,
        daemonIsolation: "default",
        command: "switchboard",
        args: ["--cwd", root, "mcp", "--mandate", "fix-ci"],
        commands: {
          mcp: {
            command: "switchboard",
            args: ["--cwd", root, "mcp", "--mandate", "fix-ci"]
          },
          toolSurface: {
            command: "switchboard",
            args: ["--cwd", root, "tools", "--mandate", "fix-ci", "--json"]
          },
          approvals: {
            command: "switchboard",
            args: [
              "--cwd",
              root,
              "approvals",
              "--mandate",
              "fix-ci",
              "--include-children",
              "--json"
            ]
          },
          report: {
            command: "switchboard",
            args: [
              "--cwd",
              root,
              "mandate",
              "report",
              "fix-ci",
              "--json"
            ]
          },
          childTemplate: {
            command: "switchboard",
            args: expect.arrayContaining([
              "--cwd",
              root,
              "mandate",
              "child",
              "<child-id>",
              "--parent",
              "fix-ci"
            ])
          }
        },
        policy: {
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
          ]
        },
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
      },
      workspaceLease: {
        schemaVersion: "switchboard.workspace-lease.v1",
        mandateId: "fix-ci",
        repo: {
          path: root,
          worktreePath: root,
          branch: "fix/ci"
        },
        runtime: {
          kind: "local",
          transport: "stdio"
        },
        envClass: "unknown",
        authority: {
          agentRole: "implementer",
          profiles: ["github_findu", "vercel_preview"],
          allowedTools: ["github_findu_*"],
          deniedTools: ["*_deploy_prod"]
        },
        mcpLaunch: {
          schemaVersion: "switchboard.mcp-launch.v1",
          mandateId: "fix-ci"
        },
        runLaunch: {
          schemaVersion: "switchboard.run-launch.v1",
          command: "switchboard",
          args: ["--cwd", root, "run", "--mandate", "fix-ci", "--"],
          env: {},
          note: expect.stringContaining("not a filesystem or network sandbox")
        },
        capabilities: {
          mcpLaunchEnv: true,
          runLaunch: true,
          structuredMcpErrors: true,
          daemonRuntimeDir: false
        },
        commands: {
          mcp: {
            args: ["--cwd", root, "mcp", "--mandate", "fix-ci"]
          }
        },
        limits: expect.arrayContaining([
          "local authority contract only; this is not a sandbox"
        ])
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

  it("creates a provider-preset mandate with current branch defaults", async () => {
    const root = makeTempProject();
    initGitRepo(root, "main");
    const mandateStorePath = join(root, "state", "mandates.json");
    writeFileSync(join(root, ".gitignore"), ".switchboard.local.yaml\n");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  github_ci:",
        "    provider: github",
        "    namespace: github_ci",
        "    upstream:",
        "      type: stdio",
        "      command: node",
        "workspaces:",
        "  default:",
        "    paths:",
        "      - .",
        "    profiles:",
        "      - github_ci"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath
    });

    await program.parseAsync(
      ["--cwd", root, "mandate", "create", "--from", "github-ci", "--json"],
      { from: "user" }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      mandate: {
        id: string;
        branch: string;
        agentRole: string;
        profiles: string[];
        lease: string;
        allowedTools: string[];
        deniedTools: string[];
        approvalGates: Array<{
          toolPattern: string;
          labels?: string[];
        }>;
      };
      mcpLaunch: { args: string[] };
    };

    expect(parsed.mandate).toMatchObject({
      id: "fix-ci",
      branch: "main",
      agentRole: "implementer",
      profiles: ["github_ci"],
      lease: "2h",
      allowedTools: ["github_ci_*"],
      deniedTools: expect.arrayContaining([
        "github_ci_delete*",
        "github_ci_create_repository"
      ])
    });
    expect(parsed.mandate.approvalGates).toHaveLength(10);
    expect(parsed.mandate.approvalGates[0]).toMatchObject({
      toolPattern: "github_ci_*comment*",
      labels: ["github", "write"]
    });
    expect(parsed.mandate.approvalGates[2]).toMatchObject({
      toolPattern: "github_ci_assign_copilot*",
      labels: ["github", "copilot", "write"]
    });
    expect(parsed.mcpLaunch.args).toEqual([
      "--cwd",
      root,
      "mcp",
      "--mandate",
      "fix-ci"
    ]);
  });

  it("uses the only matching provider profile for preset mandates", async () => {
    const root = makeTempProject();
    initGitRepo(root, "main");
    const mandateStorePath = join(root, "state", "mandates.json");
    writeFileSync(
      join(root, ".switchboard.yaml"),
      [
        "version: 1",
        "profiles:",
        "  stripe_stockr_test:",
        "    provider: stripe",
        "    namespace: stripe_stockr_test",
        "    upstream:",
        "      type: stdio",
        "      command: stripe"
      ].join("\n")
    );

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath
    });

    await program.parseAsync(
      ["--cwd", root, "mandate", "create", "--from", "stripe-test", "--json"],
      { from: "user" }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      mandate: { profiles: string[]; allowedTools: string[]; deniedTools: string[] };
    };

    expect(parsed.mandate).toMatchObject({
      profiles: ["stripe_stockr_test"],
      allowedTools: ["stripe_stockr_test_*"],
      deniedTools: expect.arrayContaining([
        "stripe_stockr_test_*live*",
        "stripe_stockr_test_*production*"
      ])
    });
  });

  it("rejects mandate create without explicit options or a preset", async () => {
    const root = makeTempProject();
    writeMandateConfig(root);

    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await program.parseAsync(
      ["--cwd", root, "mandate", "create", "fix-ci", "--json"],
      { from: "user" }
    );

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "missing_mandate_options",
      message:
        "missing required mandate option(s): --agent, --profiles, --lease"
    });
    expect(process.exitCode).toBe(1);
  });

  it("prints next commands after human mandate creation", async () => {
    const root = makeTempProject();
    const mandateStorePath = join(root, "state", "mandates.json");
    writeMandateConfig(root);

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
        "github_findu_*"
      ],
      { from: "user" }
    );

    expect(output[0]).toContain("Created mandate fix-ci");
    expect(output[0]).toContain("Next commands:");
    expect(output[0]).toContain(
      `switchboard --cwd '${root}' tools --mandate fix-ci`
    );
    expect(output[0]).toContain(
      `switchboard --cwd '${root}' mcp --mandate fix-ci`
    );
    expect(output[0]).toContain(
      `switchboard --cwd '${root}' approvals --mandate fix-ci --json`
    );
    expect(output[0]).toContain(
      `switchboard --cwd '${root}' logs --mandate fix-ci --json`
    );
    expect(output[0]).toContain(
      `switchboard --cwd '${root}' mandate handoff fix-ci --state completed --summary <summary>`
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
        runtimeDir: null,
        env: {},
        approvalWaitMs: 0,
        daemonIsolation: "default",
        args: ["--cwd", root, "mcp", "--mandate", "rerun-checks"],
        commands: {
          toolSurface: {
            command: "switchboard",
            args: [
              "--cwd",
              root,
              "tools",
              "--mandate",
              "rerun-checks",
              "--json"
            ]
          },
          report: {
            command: "switchboard",
            args: [
              "--cwd",
              root,
              "mandate",
              "report",
              "rerun-checks",
              "--json"
            ]
          },
          childTemplate: {
            command: "switchboard",
            args: expect.arrayContaining(["--parent", "rerun-checks"])
          }
        },
        policy: {
          profiles: ["github_findu"],
          allowedTools: ["github_findu_checks_*"],
          deniedTools: ["*_deploy_prod", "github_findu_checks_cancel"],
          approvalGates: [
            {
              id: "gate-1",
              toolPattern: "github_findu_checks_rerun"
            }
          ]
        },
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
      },
      workspaceLease: {
        schemaVersion: "switchboard.workspace-lease.v1",
        mandateId: "rerun-checks",
        repo: {
          path: root,
          worktreePath: root,
          branch: "fix/ci"
        },
        authority: {
          parentMandateId: "fix-ci",
          agentRole: "worker",
          profiles: ["github_findu"]
        },
        mcpLaunch: {
          mandateId: "rerun-checks"
        },
        runLaunch: {
          schemaVersion: "switchboard.run-launch.v1",
          args: ["--cwd", root, "run", "--mandate", "rerun-checks", "--"]
        },
        capabilities: {
          runLaunch: true,
          structuredMcpErrors: true
        }
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
              worktreePath: realpathSync(root),
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
              worktreePath: realpathSync(root),
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
              worktreePath: realpathSync(root),
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

  it("reports scoped missing secret refs as mandate readiness blockers", async () => {
    const root = makeTempProject();
    writeMandateSecretConfig(root);
    const mandateStorePath = join(root, "state", "mandates.json");
    const approvalStorePath = join(root, "state", "approvals.json");
    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath,
      approvalStorePath,
      secretStore: createMemorySecretStore({
        "github/findu/dev/token": "ghp_secret"
      })
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "preview",
        "--agent",
        "worker",
        "--profiles",
        "vercel_preview",
        "--branch",
        "fix/ci",
        "--lease",
        "30m",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "mandate", "report", "preview", "--json"],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "mandate", "escalate", "preview", "--json"],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "mandate", "report", "preview"],
      { from: "user" }
    );

    const report = JSON.parse(output[1] ?? "{}") as {
      readiness: {
        selectedCanHandoff: boolean;
        missingSecretRefs: Array<{
          ref: string;
          profiles: string[];
          envNames: string[];
          status: string;
        }>;
        blockers: string[];
        nextActions: string[];
      };
    };
    expect(report.readiness).toMatchObject({
      selectedCanHandoff: false,
      missingSecretRefs: [
        {
          ref: "vercel/preview/token",
          profiles: ["vercel_preview"],
          envNames: ["VERCEL_TOKEN"],
          status: "missing"
        }
      ],
      blockers: ['secretRef "vercel/preview/token" is missing'],
      nextActions: [
        "switchboard secrets set vercel/preview/token --value-stdin"
      ]
    });
    expect(JSON.stringify(report)).not.toContain("github/findu/dev/token");
    expect(JSON.stringify(report)).not.toContain("ghp_secret");

    expect(JSON.parse(output[2] ?? "{}")).toMatchObject({
      status: "needs_attention",
      counts: {
        items: 1,
        missingSecretRefs: 1
      },
      items: [
        {
          type: "missing_secret_ref",
          priority: "setup",
          mandateId: "preview",
          title: "Secret ref vercel/preview/token is missing",
          commands: [
            "switchboard secrets set vercel/preview/token --value-stdin"
          ]
        }
      ]
    });
    expect(output[3]).toContain("Missing secret refs:");
    expect(output[3]).toContain("vercel/preview/token (missing)");
    expect(output[3]).not.toContain("github/findu/dev/token");
    expect(output[3]).not.toContain("ghp_secret");
  });

  it("scopes missing secret readiness to the selected mandate subtree", async () => {
    const root = makeTempProject();
    writeMandateSecretConfig(root);
    const mandateStorePath = join(root, "state", "mandates.json");
    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath,
      secretStore: createMemorySecretStore()
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "mandate",
        "create",
        "parent",
        "--agent",
        "lead",
        "--profiles",
        "github_findu,vercel_preview",
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
        "preview",
        "--parent",
        "parent",
        "--agent",
        "worker",
        "--profiles",
        "vercel_preview",
        "--branch",
        "fix/ci",
        "--lease",
        "30m",
        "--json"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "mandate", "report", "parent", "--json"],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "mandate", "report", "preview", "--json"],
      { from: "user" }
    );

    const parentReport = JSON.parse(output[2] ?? "{}") as {
      readiness: { missingSecretRefs: Array<{ ref: string }> };
    };
    const childReport = JSON.parse(output[3] ?? "{}") as {
      readiness: { missingSecretRefs: Array<{ ref: string }> };
    };
    expect(
      parentReport.readiness.missingSecretRefs.map((missing) => missing.ref)
    ).toEqual(["github/findu/dev/token", "vercel/preview/token"]);
    expect(
      childReport.readiness.missingSecretRefs.map((missing) => missing.ref)
    ).toEqual(["vercel/preview/token"]);
  });

  it("does not use caller cwd config for all-repo mandate secret readiness", async () => {
    const callerRoot = makeTempProject();
    const mandateRoot = makeTempProject();
    writeMandateSecretConfig(callerRoot);
    const mandateStorePath = join(callerRoot, "state", "mandates.json");
    mkdirSync(join(callerRoot, "state"), { recursive: true });
    writeFileSync(
      mandateStorePath,
      JSON.stringify(
        {
          version: 1,
          mandates: [
            {
              version: 1,
              id: "preview",
              mandateUid: "preview:2026-06-22T20:00:00.000Z",
              task: "preview",
              repoPath: mandateRoot,
              worktreePath: mandateRoot,
              branch: "fix/ci",
              agentRole: "worker",
              profiles: ["vercel_preview"],
              lease: "30m",
              createdAt: "2026-06-22T20:00:00.000Z",
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
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

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath,
      secretStore: createMemorySecretStore()
    });

    await program.parseAsync(
      ["--cwd", callerRoot, "mandate", "report", "preview", "--all", "--json"],
      { from: "user" }
    );

    const report = JSON.parse(output[0] ?? "{}") as {
      repoPath: string;
      readiness: { missingSecretRefs: unknown[]; blockers: string[] };
    };
    expect(report.repoPath).toBeNull();
    expect(report.readiness.missingSecretRefs).toEqual([]);
    expect(report.readiness.blockers).toEqual([]);
    expect(output[0]).not.toContain("vercel/preview/token");
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

    await program.parseAsync(["mandate", "create", "fix-ci", "--json"], {
      from: "user"
    });
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
      code: "missing_mandate_options",
      message:
        "missing required mandate option(s): --agent, --profiles, --lease"
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
        nextActions: [
          "Run switchboard mandate status to list mandates for this repo."
        ]
      },
      {
        ok: false,
        schemaVersion: "switchboard.error.v1",
        code: "mandate_not_found",
        message: 'mandate "missing" was not found',
        nextActions: [
          "Run switchboard mandate status to list mandates for this repo."
        ]
      },
      {
        ok: false,
        schemaVersion: "switchboard.error.v1",
        code: "mandate_not_found",
        message: 'mandate "missing" was not found',
        nextActions: [
          "Run switchboard mandate status to list mandates for this repo."
        ]
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
      nextActions: ["Run switchboard mandate status to list mandates for this repo."]
    });
    expect(process.exitCode).toBe(1);
  });

  it("reports mandate runtime readiness blockers with exact next actions", async () => {
    const root = makeTempProject();
    initGitRepo(root, "main");
    writeMandateSecretConfig(root);
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
              mandateUid: "fix-ci:2026-06-22T20:00:00.000Z",
              task: "fix-ci",
              repoPath: root,
              worktreePath: realpathSync(root),
              branch: "fix/ci",
              agentRole: "worker",
              profiles: ["vercel_preview"],
              lease: "30m",
              createdAt: "2026-06-22T20:00:00.000Z",
              expiresAt: "2026-06-22T20:30:00.000Z",
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

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath,
      secretStore: createMemorySecretStore({
        "github/findu/dev/token": "ghp_secret"
      })
    });

    await program.parseAsync(
      ["--cwd", root, "mandate", "status", "fix-ci", "--json"],
      { from: "user" }
    );
    await program.parseAsync(["--cwd", root, "mandate", "status", "fix-ci"], {
      from: "user"
    });

    const parsed = JSON.parse(output[0] ?? "{}") as {
      readiness: MandateStatusReadinessTestPayload;
    };
    expect(parsed.readiness).toMatchObject({
      blockers: [
        'mandate "fix-ci" is expired',
        'mandate "fix-ci" is scoped to branch "fix/ci", but current git branch is "main"',
        'secretRef "vercel/preview/token" is missing'
      ],
      nextActions: [
        "switchboard mandate renew fix-ci --lease 30m",
        "git switch fix/ci",
        "switchboard secrets set vercel/preview/token --value-stdin"
      ],
      mandates: {
        "fix-ci": {
          blockers: [
            'mandate "fix-ci" is expired',
            'mandate "fix-ci" is scoped to branch "fix/ci", but current git branch is "main"',
            'secretRef "vercel/preview/token" is missing'
          ]
        }
      }
    });
    expect(output[1]).toContain("Runtime blockers:");
    expect(output[1]).toContain("switchboard mandate renew fix-ci --lease 30m");
    expect(output[1]).not.toContain("ghp_secret");
  });

  it("renews an expired open mandate lease", async () => {
    const root = makeTempProject();
    initGitRepo(root, "fix/ci");
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
              mandateUid: "fix-ci:2026-06-22T20:00:00.000Z",
              task: "fix-ci",
              repoPath: root,
              worktreePath: realpathSync(root),
              branch: "fix/ci",
              agentRole: "worker",
              profiles: ["github_findu"],
              lease: "30m",
              createdAt: "2026-06-22T20:00:00.000Z",
              expiresAt: "2026-06-22T20:30:00.000Z",
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

    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      mandateStorePath
    });

    await program.parseAsync(
      ["--cwd", root, "mandate", "renew", "fix-ci", "--lease", "2h", "--json"],
      { from: "user" }
    );

    const parsed = JSON.parse(output[0] ?? "{}") as {
      mandate: { lease: string; runtimeStatus: string; expiresAt: string };
    };
    expect(parsed.mandate.lease).toBe("2h");
    expect(parsed.mandate.runtimeStatus).toBe("active");
    expect(Date.parse(parsed.mandate.expiresAt)).toBeGreaterThan(Date.now());
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
    expect(output[1]).toContain("Summary: 2 pending, 0 approved, 0 denied, 1 expired, 1 stale");
    expect(output[1]).toContain("approval-1 [pending]");
    expect(output[1]).toContain("tool: github_findu_deploy");
    expect(output[1]).toContain(
      'switchboard approve approval-1 --reason "<why this is safe>"'
    );
    expect(output[1]).toContain(
      'switchboard deny approval-1 --reason "<why this should not run>"'
    );
    expect(output[1]).toContain("retry the original github_findu_deploy tool call after approval");
    expect(output[1]).toContain("reason: preview deploy touches remote state");
    expect(output[1]).toContain("risk: high");
    expect(output[1]).toContain("labels: remote-state, deploy");
    expect(output[1]).toContain(
      "retry the original gated tool call to create a fresh approval request"
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
    expect(output[3]).toContain("approval-1 [approved]");
    expect(output[3]).not.toContain("approval-2");

    await program.parseAsync(
      ["--cwd", root, "approvals", "--status", "expired"],
      { from: "user" }
    );
    expect(output[4]).toContain("approval-3 [expired]");
    expect(output[4]).not.toContain("approval-1");

    await program.parseAsync(["deny", "approval-2"], { from: "user" });
    expect(output[5]).toContain("Status: denied");

    await program.parseAsync(["--cwd", root, "approvals", "--status", "stale"], {
      from: "user"
    });
    expect(output[6]).toContain("approval-4 [stale]");
    expect(output[6]).not.toContain("approval-1");

    await program.parseAsync(["--cwd", root, "approvals", "--status", "weird"], {
      from: "user"
    });
    expect(errors).toEqual([
      "error: --status must be pending, approved, denied, stale, or expired"
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("watches approval requests with bounded JSON snapshots", async () => {
    const root = makeTempProject();
    const approvalStorePath = join(root, "state", "approvals.json");
    await createApprovalRequest({
      path: approvalStorePath,
      mandateId: "fix-ci",
      repoPath: root,
      branch: "fix/ci",
      toolName: "github_findu_deploy",
      approvalGateId: "gate-1",
      approvalGatePattern: "github_findu_deploy",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    });

    const output: string[] = [];
    const program = createProgram({
      approvalStorePath,
      writeOut: (message) => output.push(message)
    });

    await program.parseAsync(
      ["--cwd", root, "approvals", "--watch", "--timeout", "0", "--json"],
      { from: "user" }
    );

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      schemaVersion: "switchboard.approvals-watch.v1",
      watch: {
        intervalMs: 2000,
        timeoutMs: 0,
        snapshots: 1
      },
      snapshots: [
        {
          approvals: {
            schemaVersion: "switchboard.approvals.v1",
            counts: { pending: 1 },
            requests: [
              {
                id: "approval-1",
                runtimeStatus: "pending",
                toolName: "github_findu_deploy"
              }
            ]
          }
        }
      ]
    });
  });

  it("rejects approval watch options that cannot finish clearly", async () => {
    const root = makeTempProject();
    const output: string[] = [];
    const errors: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message),
      writeErr: (message) => errors.push(message)
    });

    await program.parseAsync(
      ["--cwd", root, "approvals", "--watch", "--json"],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "approvals", "--interval", "1s", "--json"],
      { from: "user" }
    );
    await program.parseAsync(
      [
        "--cwd",
        root,
        "approvals",
        "--watch",
        "--json",
        "--interval",
        "0",
        "--timeout",
        "0"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      [
        "--cwd",
        root,
        "approvals",
        "--watch",
        "--json",
        "--timeout",
        "24h"
      ],
      { from: "user" }
    );
    await program.parseAsync(
      [
        "--cwd",
        root,
        "approvals",
        "--watch",
        "--json",
        "--timeout",
        "30m"
      ],
      { from: "user" }
    );

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "missing_watch_timeout",
      message: "--watch --json requires --timeout so the JSON payload can finish",
      nextActions: [
        "Pass --timeout 0 for one JSON snapshot, or a bounded duration like --timeout 30s."
      ]
    });
    expect(JSON.parse(output[1] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "invalid_watch_options",
      message: "--interval and --timeout require --watch"
    });
    expect(JSON.parse(output[2] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "invalid_watch_duration",
      message: "--interval must be at least 1s",
      nextActions: ["Pass --interval 1s or longer."]
    });
    expect(JSON.parse(output[3] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "invalid_watch_duration",
      message: "--timeout must use 0 or a duration like 2s or 1m"
    });
    expect(JSON.parse(output[4] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "watch_timeout_too_long",
      message: "--watch --json buffers snapshots and must use --timeout 10m or less",
      nextActions: [
        "Use --timeout 0 for one snapshot, or poll with shorter bounded windows."
      ]
    });
    expect(errors).toEqual([]);
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

  it("prints approval request JSON validation errors to stdout", async () => {
    const root = makeTempProject();
    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message)
    });

    await program.parseAsync(
      ["--cwd", root, "approvals", "--status", "weird", "--json"],
      { from: "user" }
    );
    await program.parseAsync(
      ["--cwd", root, "approvals", "--include-children", "--json"],
      { from: "user" }
    );
    await program.parseAsync(
      [
        "--cwd",
        root,
        "approvals",
        "--include-children",
        "--mandate",
        "fix-ci",
        "--all",
        "--json"
      ],
      { from: "user" }
    );

    expect(JSON.parse(output[0] ?? "{}")).toEqual({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "invalid_status",
      message: "--status must be pending, approved, denied, stale, or expired",
      nextActions: [
        "Pass --status as pending, approved, denied, stale, or expired."
      ]
    });
    expect(JSON.parse(output[1] ?? "{}")).toEqual({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "missing_mandate",
      message: "--include-children requires --mandate <id>",
      nextActions: ["Pass --mandate <id> with --include-children."]
    });
    expect(JSON.parse(output[2] ?? "{}")).toEqual({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "invalid_scope",
      message: "--include-children must be repo-scoped; remove --all",
      nextActions: ["Remove --all when using --include-children."]
    });
    expect(process.exitCode).toBe(1);
  });

  it("prints missing approval mandate JSON errors to stdout", async () => {
    const root = makeTempProject();
    const output: string[] = [];
    const program = createProgram({
      mandateStorePath: join(root, "state", "mandates.json"),
      writeOut: (message) => output.push(message)
    });

    await program.parseAsync(
      [
        "--cwd",
        root,
        "approvals",
        "--include-children",
        "--mandate",
        "fix-ci",
        "--json"
      ],
      { from: "user" }
    );

    expect(JSON.parse(output[0] ?? "{}")).toEqual({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "mandate_not_found",
      message: 'mandate "fix-ci" was not found',
      nextActions: []
    });
    expect(process.exitCode).toBe(1);
  });

  it("prints missing approval mandate human errors to stderr", async () => {
    const root = makeTempProject();
    const errors: string[] = [];
    const program = createProgram({
      mandateStorePath: join(root, "state", "mandates.json"),
      writeErr: (message) => errors.push(message)
    });

    await program.parseAsync(
      ["--cwd", root, "approvals", "--include-children", "--mandate", "fix-ci"],
      { from: "user" }
    );

    expect(errors).toEqual(['error: mandate "fix-ci" was not found']);
    expect(process.exitCode).toBe(1);
  });

  it("prints parser errors for approval request JSON commands to stdout", async () => {
    const output: string[] = [];
    const program = createProgram({
      writeOut: (message) => output.push(message)
    });

    await expect(
      program.parseAsync(["approvals", "--json", "--status"], {
        from: "user"
      })
    ).rejects.toThrow();

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "invalid_command",
      message: "option '--status <status>' argument missing"
    });
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
      ok: true,
      schemaVersion: "switchboard.audit-log.v1",
      path: logPath,
      mandateId: null,
      filters: {
        mandateId: null,
        limit: 1
      },
      counts: {
        totalMatching: 2,
        returned: 1
      },
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
      ok: true,
      schemaVersion: "switchboard.audit-log.v1",
      path: logPath,
      mandateId: "fix-ci",
      filters: {
        mandateId: "fix-ci",
        limit: 1
      },
      counts: {
        totalMatching: 2,
        returned: 1
      },
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

  it("prints local audit log JSON errors to stdout", async () => {
    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });
    await program.parseAsync(["logs", "--json", "--limit", "0"], {
      from: "user"
    });

    expect(JSON.parse(output[0] ?? "{}")).toEqual({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "invalid_limit",
      message: "--limit must be a positive integer",
      nextActions: ["Pass --limit with a positive integer value."]
    });
    expect(process.exitCode).toBe(1);
  });

  it("prints parser errors for audit log JSON commands to stdout", async () => {
    const root = makeTempProject();
    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await expect(
      program.parseAsync(["--cwd", root, "logs", "--json", "--limit"], {
        from: "user"
      })
    ).rejects.toThrow();

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "invalid_command",
      message: "option '--limit <count>' argument missing"
    });
  });

  it("prints unknown-option audit log JSON parser errors to stdout", async () => {
    const output: string[] = [];
    const program = createProgram({ writeOut: (message) => output.push(message) });

    await expect(
      program.parseAsync(["logs", "--json", "--bogus"], {
        from: "user"
      })
    ).rejects.toThrow();

    expect(JSON.parse(output[0] ?? "{}")).toMatchObject({
      ok: false,
      schemaVersion: "switchboard.error.v1",
      code: "unknown_option",
      message: "unknown option '--bogus'"
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

function repoSlug(root: string): string {
  return basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function githubRepoProfile(root: string): string {
  return `github_${repoSlug(root)}_ci`;
}

function githubRepoSecretRef(root: string): string {
  return `github/${repoSlug(root)}/dev/token`;
}

function vercelRepoProfile(root: string): string {
  return `vercel_${repoSlug(root)}_preview`;
}

function vercelRepoSecretRef(root: string): string {
  return `vercel/${repoSlug(root)}/preview/token`;
}

function stripeRepoProfile(root: string): string {
  return `stripe_${repoSlug(root)}_test`;
}

function stripeRepoSecretRef(root: string): string {
  return `stripe/${repoSlug(root)}/test/secret-key`;
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

function secretRefProfileYaml(): string {
  return [
    "version: 1",
    "profiles:",
    "  github_findu:",
    "    provider: generic",
    "    upstream:",
    "      type: stdio",
    "      command: node",
    "      env:",
    "        GITHUB_TOKEN:",
    "          secretRef: github/findu/dev/token"
  ].join("\n");
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

function namespacedTool(name: string): {
  name: string;
  profileName: string;
  namespace: string;
  upstreamName: string;
  inputSchema: { type: "object" };
} {
  const namespace = name.startsWith("github_findu_")
    ? "github_findu"
    : "github_ci";
  return {
    name,
    profileName: namespace,
    namespace,
    upstreamName: name.slice(namespace.length + 1),
    inputSchema: { type: "object" }
  };
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

function writeMandateSecretConfig(root: string): void {
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
      "      env:",
      "        GITHUB_TOKEN:",
      "          secretRef: github/findu/dev/token",
      "  vercel_preview:",
      "    provider: generic",
      "    namespace: vercel_preview",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - vercel-preview",
      "      env:",
      "        VERCEL_TOKEN:",
      "          secretRef: vercel/preview/token"
    ].join("\n")
  );
}

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
