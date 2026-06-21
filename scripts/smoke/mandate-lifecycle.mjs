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
    "--allow-tool",
    "github_findu_*",
    "--deny-tool",
    "*_deploy_prod",
    "--require-approval-tool",
    "github_findu_checks_rerun",
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

  const child = run(
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
  );
  assert(child.mandate?.id === "rerun-checks", "expected child mandate");
  assert(
    child.mandate?.parentMandateId === "fix-ci",
    "expected parent binding"
  );
  assert(
    child.mandate?.delegationPath?.join(">") === "fix-ci>rerun-checks",
    "expected delegation path"
  );
  assert(
    child.mandate?.deniedTools?.join(",") ===
      "*_deploy_prod,github_findu_checks_cancel",
    "expected inherited denied tools"
  );
  assert(
    child.mcpLaunch?.args?.join(" ") ===
      `--cwd ${project} mcp --mandate rerun-checks`,
    "expected child MCP launch payload"
  );

  const childStatus = run("mandate", "status", "--json");
  assert(childStatus.mandates?.length === 2, "expected parent and child");
  assert(
    childStatus.mandates.some(
      (mandate) =>
        mandate.id === "rerun-checks" && mandate.parentMandateId === "fix-ci"
    ),
    "expected child status entry"
  );

  const auditPath = join(stateRoot, "switchboard", "logs", "switchboard.jsonl");
  mkdirSync(join(stateRoot, "switchboard", "logs"), { recursive: true });
  writeFileSync(
    auditPath,
    [
      {
        version: 1,
        timestamp: "2026-06-19T14:00:00.000Z",
        action: "tool_call",
        status: "ok",
        profileName: "github_findu",
        toolName: "github_findu_checks_list",
        mandateId: "fix-ci"
      },
      {
        version: 1,
        timestamp: "2026-06-19T14:05:00.000Z",
        action: "tool_call",
        status: "ok",
        profileName: "github_findu",
        toolName: "github_findu_checks_rerun",
        mandateId: "rerun-checks"
      }
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n"
  );

  const logs = run("logs", "--mandate", "fix-ci", "--json");
  assert(logs.entries?.length === 1, "expected one mandate audit entry");
  assert(logs.entries[0]?.mandateId === "fix-ci", "expected mandate log filter");

  const childLogs = run("logs", "--mandate", "rerun-checks", "--json");
  assert(childLogs.entries?.length === 1, "expected one child audit entry");
  assert(
    childLogs.entries[0]?.mandateId === "rerun-checks",
    "expected child mandate log filter"
  );
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
