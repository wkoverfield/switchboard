#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const repo = resolve(import.meta.dirname, "..", "..");
const projectRoot = mkdtempSync(join(tmpdir(), "switchboard-import-smoke-"));
const project = join(projectRoot, "stockr");
const cliPath = join(repo, "apps/cli/dist/index.js");

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:import-dry-run`."
  );
}

try {
  mkdirSync(project);
  mkdirSync(join(project, ".codex"), { recursive: true });
  writeFileSync(
    join(project, ".codex", "config.toml"),
    [
      "[mcp_servers.github]",
      'command = "docker"',
      'args = ["run", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN", "ghcr.io/github/github-mcp-server"]',
      'env = { GITHUB_PERSONAL_ACCESS_TOKEN = "ghp_should_not_print" }'
    ].join("\n")
  );
  writeFileSync(
    join(project, ".mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          vercel: {
            command: "npx",
            args: ["-y", "vercel-platform-mcp-server"],
            env: {
              VERCEL_TOKEN: "vercel_should_not_print"
            }
          }
        }
      },
      null,
      2
    )
  );

  const plan = runCli("import", "--json");
  assert(plan.schemaVersion === "switchboard.import-plan.v1", "plan schema");
  assert(plan.mode === "dry-run", "expected dry-run mode");
  assert(
    plan.actions.some(
      (action) =>
        action.kind === "create-profile" &&
        action.profileName === "github_stockr"
    ),
    "expected github profile action"
  );
  assert(
    plan.commands.secretCommands.some((command) =>
      command.args.includes("github/stockr/dev/token")
    ),
    "expected github token alias command"
  );
  assert(!existsSync(join(project, ".switchboard.yaml")), "dry-run must not write config");
  assertNoRawSecret(JSON.stringify(plan), "json plan");

  const human = runCliText("import", "--dry-run");
  assert(human.includes("Switchboard import plan for stockr"), "expected human heading");
  assert(human.includes("Dry run: no files were written."), "expected dry-run copy");
  assert(human.includes("github_stockr"), "expected github profile in human output");
  assertNoRawSecret(human, "human plan");

  const beforeCodex = readFileSync(join(project, ".codex", "config.toml"), "utf8");
  const beforeClaude = readFileSync(join(project, ".mcp.json"), "utf8");
  const written = runCli("import", "--write", "--json");
  assert(written.action === "created", "expected import write to create config");
  assert(
    written.createdProfiles.includes("github_stockr"),
    "expected github profile to be written"
  );
  assert(existsSync(join(project, ".switchboard.yaml")), "expected repo config write");
  const config = readFileSync(join(project, ".switchboard.yaml"), "utf8");
  assert(config.includes("secretRef: github/stockr/dev/token"), "expected secretRef");
  assert(
    readFileSync(join(project, ".codex", "config.toml"), "utf8") === beforeCodex,
    "codex config must not be mutated"
  );
  assert(
    readFileSync(join(project, ".mcp.json"), "utf8") === beforeClaude,
    "claude config must not be mutated"
  );
  assertNoRawSecret(JSON.stringify(written), "write json");
  assertNoRawSecret(config, "written config");

  const second = runCli("import", "--write", "--json");
  assert(second.action === "noop", "second write should be a noop");
} finally {
  rmSync(projectRoot, { force: true, recursive: true });
}

function runCli(...args) {
  return JSON.parse(runCliText(...args));
}

function runCliText(...args) {
  const result = spawnSync(process.execPath, [cliPath, "--cwd", project, ...args], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(result.stdout);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function assertNoRawSecret(value, label) {
  assert(!value.includes("ghp_should_not_print"), `${label} leaked GitHub token`);
  assert(!value.includes("vercel_should_not_print"), `${label} leaked Vercel token`);
}

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
