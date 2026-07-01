#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)), "..");
const cliPath = resolve(repoRoot, "apps", "cli", "dist", "index.js");
const project = mkdtempSync(join(tmpdir(), "switchboard-lease-evidence-"));
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
      "  github_ci:",
      "    provider: github",
      "    namespace: github_ci"
    ].join("\n")
  );

  const created = run(
    "mandate",
    "create",
    "fix-flaky-tests",
    "--agent",
    "implementer",
    "--actor",
    "human-wilson",
    "--profiles",
    "github_findu",
    "--branch",
    "fix/ci",
    "--lease",
    "1h",
    "--allow-tool",
    "github_findu_*",
    "--require-approval-tool",
    "github_findu_checks_rerun",
    "--json"
  );
  assert(created.mandate?.createdBy === "human-wilson", "expected createdBy actor");
  assert(
    created.mandate?.authoritySource?.type === "manual",
    "expected manual authority source"
  );
  assert(
    /^sha256:[0-9a-f]{64}$/.test(created.mandate?.policyHash ?? ""),
    "expected sha256 policy hash"
  );
  assert(
    created.mandate?.leaseEvents?.length === 1 &&
      created.mandate.leaseEvents[0].type === "created" &&
      created.mandate.leaseEvents[0].actor === "human-wilson",
    "expected created lease event with actor"
  );
  assert(
    created.mcpLaunch?.policy?.policyHash === created.mandate.policyHash,
    "expected mcpLaunch policy hash to match mandate"
  );
  assert(
    created.workspaceLease?.authority?.createdBy === "human-wilson" &&
      created.workspaceLease?.authority?.policyHash ===
        created.mandate.policyHash &&
      created.workspaceLease?.authority?.source?.type === "manual",
    "expected workspace lease authority evidence"
  );
  assert(
    created.workspaceLease?.lease?.events?.length === 1,
    "expected workspace lease events"
  );

  const presetCreated = run(
    "mandate",
    "create",
    "--from",
    "github-ci",
    "--actor",
    "harness-a",
    "--json"
  );
  assert(
    presetCreated.mandate?.authoritySource?.type === "preset" &&
      presetCreated.mandate?.authoritySource?.ref === "github-ci",
    "expected preset authority source"
  );
  assert(
    presetCreated.mandate?.createdBy === "harness-a",
    "expected preset mandate actor"
  );

  const renewed = run(
    "mandate",
    "renew",
    "fix-flaky-tests",
    "--lease",
    "2h",
    "--actor",
    "harness-b",
    "--json"
  );
  assert(
    renewed.mandate?.leaseEvents?.length === 2 &&
      renewed.mandate.leaseEvents[1].type === "renewed" &&
      renewed.mandate.leaseEvents[1].actor === "harness-b" &&
      renewed.mandate.leaseEvents[1].lease === "2h",
    "expected renewed lease event with actor"
  );
  assert(
    renewed.mandate?.policyHash === created.mandate.policyHash,
    "expected renewal to preserve policy hash"
  );

  const child = run(
    "mandate",
    "child",
    "rerun checks",
    "--parent",
    "fix-flaky-tests",
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
    "--json"
  );
  assert(
    child.mandate?.authoritySource?.type === "parent" &&
      child.mandate?.authoritySource?.ref === "fix-flaky-tests",
    "expected parent authority source on child"
  );
  assert(
    child.mandate?.createdBy === "lead-agent",
    "expected child createdBy to default to --delegated-by"
  );
  assert(
    /^sha256:[0-9a-f]{64}$/.test(child.mandate?.policyHash ?? "") &&
      child.mandate.policyHash !== created.mandate.policyHash,
    "expected child policy hash for narrowed policy"
  );

  const report = run("mandate", "report", "fix-flaky-tests", "--json");
  assert(Array.isArray(report.evidence), "expected report evidence array");
  assert(
    report.evidence.length === 2,
    "expected evidence for parent and child mandates"
  );
  const parentEvidence = report.evidence.find((entry) => entry.id === "fix-flaky-tests");
  const childEvidence = report.evidence.find(
    (entry) => entry.id === "rerun-checks"
  );
  assert(
    parentEvidence?.createdBy === "human-wilson" &&
      parentEvidence?.policyHash === created.mandate.policyHash &&
      parentEvidence?.leaseEvents?.length === 2,
    "expected parent evidence in report"
  );
  assert(
    childEvidence?.authoritySource?.type === "parent" &&
      childEvidence?.leaseEvents?.length === 1,
    "expected child evidence in report"
  );

  const serialized = JSON.stringify([created, presetCreated, renewed, child, report]);
  assert(
    !serialized.includes("secretValue") && !serialized.includes("GITHUB_TOKEN="),
    "expected no raw secret material in evidence outputs"
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
