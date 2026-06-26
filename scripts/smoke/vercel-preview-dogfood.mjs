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
const project = mkdtempSync(join(tmpdir(), "switchboard-vercel-preview-"));
const secretRef = "vercel/example/preview/token";
const secretValue = "vercel-preview-secret-do-not-print";
const secretHash = sha256(secretValue);
const providerToolNames = [
  "list_deployments",
  "get_deployment",
  "get_deployment_events",
  "get_runtime_logs",
  "create_deployment",
  "cancel_deployment",
  "delete_deployment",
  "rollback_deployment",
  "deploy_prod",
  "deploy_production",
  "promote_production",
  "env_list",
  "create_env",
  "environment_update",
  "domains_list",
  "domain_add",
  "token_create",
  "billing_list",
  "team_members"
];

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:vercel-preview-dogfood`."
  );
}

try {
  run("git", ["init", "-b", "preview"], { cwd: project });
  writeFileSync(join(project, ".gitignore"), ".switchboard.local.yaml\n");

  const add = runCliJson(
    "add",
    "vercel-preview",
    "--command",
    process.execPath,
    "--arg",
    fixtureServerPath,
    "--arg",
    "vercel_preview",
    "--arg",
    "VERCEL_TOKEN",
    "--arg",
    secretHash,
    ...providerToolNames.flatMap((toolName) => ["--arg", toolName]),
    "--write",
    "--json"
  );
  assert(add.action === "created", "expected vercel preview add to create config");
  assert(
    add.commands?.mandateCreate?.args?.includes?.("--from"),
    "expected structured mandate create command"
  );
  assertNoSecretText(JSON.stringify(add), "provider add");

  const setSecret = runCli(
    ["secrets", "set", secretRef, "--value-stdin", "--json"],
    secretValue
  );
  assert(setSecret.status === 0, "expected secret set to succeed");
  assertNoSecretLeak(setSecret, "secret set");

  const check = runCliJson(
    "presets",
    "check",
    "vercel-preview",
    "--profile",
    "vercel_preview",
    "--json"
  );
  assert(check.ok === true, "expected Vercel preview policy to cover fixture tools");
  assert(check.policyCovered === true, "expected policy-covered Vercel fixture");
  assert(check.counts?.allowedSensitive === 0, "expected no allowed-sensitive tools");
  assert(check.counts?.notAllowed === 0, "expected no not-allowed tools");
  assert(check.counts?.allowed === 6, "expected echo, whoami, and read/log tools allowed");
  assert(check.counts?.approvalRequired === 4, "expected deployment write/rollback approval gates");
  assert(check.counts?.denied === 12, "expected production/admin tools denied");
  assertToolClass(check, "vercel_preview_list_deployments", "allowed");
  assertToolClass(check, "vercel_preview_get_deployment", "allowed");
  assertToolClass(check, "vercel_preview_get_deployment_events", "allowed");
  assertToolClass(check, "vercel_preview_get_runtime_logs", "allowed");
  assertToolClass(check, "vercel_preview_create_deployment", "approval_required");
  assertToolClass(check, "vercel_preview_cancel_deployment", "approval_required");
  assertToolClass(check, "vercel_preview_delete_deployment", "approval_required");
  assertToolClass(check, "vercel_preview_rollback_deployment", "approval_required");
  assertToolClass(check, "vercel_preview_deploy_prod", "denied");
  assertToolClass(check, "vercel_preview_deploy_production", "denied");
  assertToolClass(check, "vercel_preview_env_list", "denied");
  assertToolClass(check, "vercel_preview_create_env", "denied");
  assertToolClass(check, "vercel_preview_environment_update", "denied");
  assertToolClass(check, "vercel_preview_domains_list", "denied");
  assertToolClass(check, "vercel_preview_domain_add", "denied");
  assertToolClass(check, "vercel_preview_secret_status", "denied");
  assertToolClass(check, "vercel_preview_billing_list", "denied");
  assertToolClass(check, "vercel_preview_team_members", "denied");
  assertNoSecretText(JSON.stringify(check), "preset check");

  const mandate = runCliJson(
    "mandate",
    "create",
    "--from",
    "vercel-preview",
    "--json"
  );
  assert(mandate.mandate?.id === "inspect-preview", "expected template task id");
  assert(mandate.mandate?.branch === "preview", "expected current branch");
  assert(
    mandate.mandate?.deniedTools?.includes?.("vercel_preview_deploy_prod"),
    "expected production deploy denied"
  );
  assert(
    mandate.mandate?.approvalGates?.some?.(
      (gate) => gate.toolPattern === "vercel_preview_create_deployment"
    ),
    "expected create deployment approval gate"
  );
  assertNoSecretText(JSON.stringify(mandate), "mandate create");

  const tools = runCliJson("tools", "--mandate", "inspect-preview", "--json");
  assert(
    tools.tools?.some?.((tool) => tool.name === "vercel_preview_echo"),
    "expected preview tool surface"
  );
  assertNoSecretText(JSON.stringify(tools), "tool surface");

  const report = runCliJson("mandate", "report", "inspect-preview", "--json");
  assert(
    report.readiness?.selectedCanHandoff === true,
    "expected preview mandate ready for handoff"
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

function assertToolClass(check, toolName, classification) {
  assert(
    check.tools?.some?.(
      (tool) =>
        tool.toolName === toolName && tool.classification === classification
    ),
    `expected ${toolName} to be ${classification}`
  );
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
