#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const repo = resolve(import.meta.dirname, "..", "..");
const cliPath = join(repo, "apps/cli/dist/index.js");
const fixtureServerPath = join(
  repo,
  "packages/mcp-runtime/fixtures/echo-server.mjs"
);
const project = mkdtempSync(join(tmpdir(), "switchboard-harness-proof-"));
const secretRef = "github/example/dev/token";
const secretValue = "harness-proof-secret-do-not-print";
const secretHash = sha256(secretValue);

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:harness-subagent-proof`."
  );
}

try {
  run("git", ["init", "-b", "main"], { cwd: project });
  writeFileSync(join(project, ".gitignore"), ".switchboard.local.yaml\n");

  const add = runCliJson(
    "add",
    "github-ci",
    "--command",
    process.execPath,
    "--arg",
    fixtureServerPath,
    "--arg",
    "github_ci",
    "--arg",
    "GITHUB_PERSONAL_ACCESS_TOKEN",
    "--arg",
    secretHash,
    "--write",
    "--json"
  );
  assert(add.action === "created", "expected provider add to write config");
  assertNoSecretText(JSON.stringify(add), "provider add");

  const setSecret = runCli(
    ["secrets", "set", secretRef, "--value-stdin", "--json"],
    secretValue
  );
  assert(setSecret.status === 0, "expected secret set to succeed");
  assertNoSecretLeak(setSecret, "secret set");

  const parent = runCliJson("mandate", "create", "--from", "github-ci", "--json");
  assert(parent.mandate?.id === "fix-ci", "expected parent mandate id");
  assert(parent.mandate?.branch === "main", "expected current branch binding");
  assert(
    parent.mcpLaunch?.args?.join(" ") ===
      `--cwd ${project} mcp --mandate fix-ci`,
    "expected harness mcpLaunch args"
  );
  assertNoSecretText(JSON.stringify(parent), "parent mandate");

  const parentTools = runCliJson("tools", "--mandate", "fix-ci", "--json");
  assert(
    parentTools.tools?.some?.((tool) => tool.name === "github_ci_echo"),
    "expected parent scoped tool surface"
  );
  assertNoSecretText(JSON.stringify(parentTools), "parent tool surface");

  const child = runCliJson(
    "mandate",
    "child",
    "inspect-ci",
    "--parent",
    "fix-ci",
    "--agent",
    "tester",
    "--profiles",
    "github_ci",
    "--branch",
    "main",
    "--lease",
    "30m",
    "--allow-tool",
    "github_ci_echo",
    "--delegated-by",
    "harness-smoke",
    "--json"
  );
  assert(child.mandate?.id === "inspect-ci", "expected child mandate id");
  assert(
    child.mandate?.parentMandateId === "fix-ci",
    "expected parent delegation link"
  );
  assertNoSecretText(JSON.stringify(child), "child mandate");

  const childTools = runCliJson("tools", "--mandate", "inspect-ci", "--json");
  assert(
    childTools.tools?.map?.((tool) => tool.name).join(",") === "github_ci_echo",
    "expected narrowed child tool surface"
  );
  assertNoSecretText(JSON.stringify(childTools), "child tool surface");

  const report = runCliJson("mandate", "report", "fix-ci", "--json");
  assert(
    report.childrenByParent?.["fix-ci"]?.includes?.("inspect-ci"),
    "expected report to include child mandate"
  );
  assert(
    report.counts?.mandates === 2,
    "expected report to include parent and child"
  );
  assertNoSecretText(JSON.stringify(report), "mandate report");
} finally {
  runCli(["secrets", "remove", secretRef], undefined, { allowFailure: true });
  rmSync(project, { force: true, recursive: true });
}

function runCliJson(...args) {
  const result = runCli(args);
  if (result.status !== 0) {
    throw new Error(
      `switchboard ${args.join(" ")} failed\nstdout:\n${redactSecret(result.stdout)}\nstderr:\n${redactSecret(result.stderr)}`
    );
  }
  assertNoSecretLeak(result, `switchboard ${args.join(" ")}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function runCli(args, input, options = {}) {
  const result = run(process.execPath, [cliPath, "--cwd", project, ...args], {
    cwd: repo,
    input,
    env: smokeEnv()
  });
  if (!options.allowFailure && result.status !== 0) {
    return result;
  }
  return result;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...options
  });
}

function smokeEnv() {
  return {
    ...process.env,
    XDG_CONFIG_HOME: join(project, "xdg-config"),
    XDG_DATA_HOME: join(project, "xdg-data"),
    XDG_STATE_HOME: join(project, "xdg-state"),
    TS_KEYRING_BACKEND: "file",
    SWITCHBOARD_ALLOW_UNSAFE_SECRET_BACKENDS: "1"
  };
}

function assertNoSecretLeak(result, label) {
  assertNoSecretText(result.stdout, `${label} stdout`);
  assertNoSecretText(result.stderr, `${label} stderr`);
}

function assertNoSecretText(value, label) {
  assert(!value.includes(secretValue), `${label} printed secret value`);
}

function redactSecret(value) {
  return value.replaceAll(secretValue, "[redacted]");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
