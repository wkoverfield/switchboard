#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const repo = resolve(import.meta.dirname, "..", "..");
const project = mkdtempSync(join(tmpdir(), "switchboard-provider-add-"));
const cliPath = join(repo, "apps/cli/dist/index.js");

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:provider-add`."
  );
}

try {
  writeFileSync(join(project, ".gitignore"), ".switchboard.local.yaml\n");

  const plan = runCli(
    "add",
    "github-ci",
    "--profile-name",
    "github_findu",
    "--namespace",
    "GitHub FindU",
    "--secret-ref",
    "github/findu/dev/token",
    "--json"
  );
  const configPath = join(project, ".switchboard.yaml");
  assert(plan.schemaVersion === "switchboard.provider-add.v1", "plan schema");
  assert(plan.action === "create-planned", "expected dry-run create plan");
  assert(plan.targetPath === configPath, "expected repo-local target");
  assert(plan.profileName === "github_findu", "expected custom profile");
  assert(plan.namespace === "github_findu", "expected normalized namespace");
  assert(
    plan.configYaml.includes("GITHUB_PERSONAL_ACCESS_TOKEN"),
    "expected official GitHub MCP env name"
  );
  assert(
    plan.mandateCommand.includes("--profiles github_findu"),
    "expected mandate command"
  );
  assert(!existsSync(configPath), "dry-run must not write .switchboard.yaml");
  assertNoRawSecret(JSON.stringify(plan), "dry-run plan");

  const written = runCli(
    "add",
    "github-ci",
    "--profile-name",
    "github_findu",
    "--namespace",
    "GitHub FindU",
    "--secret-ref",
    "github/findu/dev/token",
    "--write",
    "--json"
  );
  assert(written.action === "created", "expected first write to create");
  assert(written.backupPath === null, "expected no backup on create");
  assert(existsSync(configPath), "expected .switchboard.yaml to be written");
  const content = readFileSync(configPath, "utf8");
  assert(content.includes("github_findu:"), "expected github profile");
  assert(
    content.includes("secretRef: github/findu/dev/token"),
    "expected secretRef in config"
  );
  assertNoRawSecret(content, "written config");

  const second = runCli(
    "add",
    "github-ci",
    "--profile-name",
    "github_findu",
    "--secret-ref",
    "github/findu/dev/token",
    "--write",
    "--json"
  );
  assert(second.action === "updated", "expected second write to update");
  assert(
    typeof second.backupPath === "string" && existsSync(second.backupPath),
    "expected second write to create backup"
  );
} finally {
  rmSync(project, { force: true, recursive: true });
}

function runCli(...args) {
  const result = spawnSync(process.execPath, [cliPath, "--cwd", project, ...args], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(result.stdout);
    process.exit(result.status ?? 1);
  }

  return JSON.parse(result.stdout);
}

function assertNoRawSecret(value, label) {
  assert(!value.includes("ghp_"), `${label} contains GitHub token-like text`);
}

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
