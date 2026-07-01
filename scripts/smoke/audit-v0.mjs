#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const repo = resolve(import.meta.dirname, "..", "..");
const cliPath = join(repo, "apps/cli/dist/index.js");
const project = mkdtempSync(join(tmpdir(), "switchboard-audit-v0-"));

try {
  run("git", ["init", "-b", "main"], { cwd: project });
  mkdirSync(join(project, ".codex"), { recursive: true });
  writeFileSync(
    join(project, ".codex", "config.toml"),
    [
      "[mcp_servers.github]",
      'command = "docker"',
      'args = ["run", "GITHUB_TOKEN=ghp_audit_smoke_should_not_print", "ghcr.io/github/github-mcp-server"]',
      'env = { GITHUB_TOKEN = "ghp_audit_smoke_should_not_print" }'
    ].join("\n")
  );

  const audit = runCliJson(["audit", "--json"]);
  assert(audit.schemaVersion === "switchboard.repo-audit.v1", "schema");
  assert(audit.status === "unsafe", "unsafe status");
  assert(audit.findingSummary.bypasses === 1, "bypass count");
  assert(
    audit.checks.some(
      (check) => check.id === "direct-mcp-bypasses" && check.status === "fail"
    ),
    "bypass check"
  );
  assert(
    audit.checks.some((check) => check.id === "unknown-mcp-commands"),
    "unknown command check"
  );
  assert(
    audit.findingSummary.directClientServers === 1,
    "direct client server count"
  );
  assert(
    JSON.stringify(audit).includes("switchboard import --write --cleanup-client"),
    "cleanup next action"
  );
  assert(
    !JSON.stringify(audit).includes("ghp_audit_smoke_should_not_print"),
    "redacted JSON"
  );

  const human = runCli(["audit"]);
  assert(human.stdout.includes("Switchboard audit: unsafe"), "human status");
  assert(human.stdout.includes("fail: Direct MCP bypasses"), "human check");
  assert(
    !human.stdout.includes("ghp_audit_smoke_should_not_print"),
    "redacted human"
  );

  const exported = runCli(["audit", "export", "--format", "jsonl"]);
  assert(
    exported.stdout.includes("switchboard.repo-audit-export.v1"),
    "export schema"
  );
  assert(exported.stdout.includes('"type":"summary"'), "export summary");
  assert(exported.stdout.includes('"type":"check"'), "export checks");
  assert(
    !exported.stdout.includes("ghp_audit_smoke_should_not_print"),
    "redacted export"
  );
} finally {
  rmSync(project, { force: true, recursive: true });
}

function runCliJson(args) {
  const result = runCli(args);
  if (result.status !== 0) {
    throw new Error(
      `switchboard ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return JSON.parse(result.stdout);
}

function runCli(args) {
  return run(process.execPath, [cliPath, "--cwd", project, ...args], {
    cwd: repo,
    env: {
      ...process.env,
      XDG_STATE_HOME: join(project, "xdg-state")
    }
  });
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
