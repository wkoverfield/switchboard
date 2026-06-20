#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)), "..");
const cliPath = resolve(repoRoot, "apps", "cli", "dist", "index.js");
const project = mkdtempSync(join(tmpdir(), "switchboard-mandate-smoke-"));
const stateRoot = join(project, "state");

try {
  writeFileSync(join(project, ".gitignore"), ".switchboard.local.yaml\n");
  writeFileSync(
    join(project, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic",
      "  vercel_preview:",
      "    provider: generic"
    ].join("\n")
  );

  const created = run(
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
  );
  assert(created.mandate?.id === "fix-ci", "expected fix-ci mandate");
  assert(created.mandate?.repoPath === project, "expected repo path binding");
  assert(
    created.mandate?.profiles?.join(",") === "github_findu,vercel_preview",
    "expected profile bindings"
  );

  const status = run("mandate", "status", "--json");
  assert(status.mandates?.length === 1, "expected one repo-scoped mandate");
  assert(status.mandates[0]?.id === "fix-ci", "expected status to show fix-ci");

  const auditPath = join(stateRoot, "switchboard", "logs", "switchboard.jsonl");
  mkdirSync(join(stateRoot, "switchboard", "logs"), { recursive: true });
  writeFileSync(
    auditPath,
    `${JSON.stringify({
      version: 1,
      timestamp: "2026-06-19T14:00:00.000Z",
      action: "tool_call",
      status: "ok",
      profileName: "github_findu",
      toolName: "github_findu_checks_list",
      mandateId: "fix-ci"
    })}\n`
  );

  const logs = run("logs", "--mandate", "fix-ci", "--json");
  assert(logs.entries?.length === 1, "expected one mandate audit entry");
  assert(logs.entries[0]?.mandateId === "fix-ci", "expected mandate log filter");
} finally {
  rmSync(project, { force: true, recursive: true });
}

function run(...args) {
  const result = spawnSync(process.execPath, [cliPath, "--cwd", project, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      XDG_STATE_HOME: stateRoot
    }
  });

  if (result.status !== 0) {
    throw new Error(
      `switchboard ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }

  return JSON.parse(result.stdout);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
