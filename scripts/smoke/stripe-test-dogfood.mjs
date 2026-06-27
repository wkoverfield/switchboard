#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";

const repo = resolve(import.meta.dirname, "..", "..");
const cliPath = join(repo, "apps/cli/dist/index.js");
const fixtureServerPath = join(
  repo,
  "packages/mcp-runtime/fixtures/echo-server.mjs"
);
const project = mkdtempSync(join(tmpdir(), "switchboard-stripe-test-"));
const repoSlug = safeIdentifier(basename(project));
const profileName = `stripe_${repoSlug}_test`;
const secretRef = `stripe/${repoSlug}/test/secret-key`;
const secretValue = "stripe-test-secret-do-not-print";
const secretHash = sha256(secretValue);
const providerToolNames = [
  "list_customers",
  "get_payment_intent",
  "search_charges",
  "create_customer",
  "update_subscription",
  "refund_charge",
  "cancel_subscription",
  "capture_payment_intent",
  "confirm_payment_intent",
  "live_charges",
  "production_balance",
  "payout_create",
  "transfer_create",
  "account_update",
  "webhook_secret_create",
  "token_create"
];

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:stripe-test-dogfood`."
  );
}

try {
  run("git", ["init", "-b", "payments"], { cwd: project });
  writeFileSync(join(project, ".gitignore"), ".switchboard.local.yaml\n");

  const add = runCliJson(
    "add",
    "stripe-test",
    "--command",
    process.execPath,
    "--arg",
    fixtureServerPath,
    "--arg",
    profileName,
    "--arg",
    "STRIPE_API_KEY",
    "--arg",
    secretHash,
    ...providerToolNames.flatMap((toolName) => ["--arg", toolName]),
    "--write",
    "--json"
  );
  assert(add.action === "created", "expected stripe-test add to create config");
  assert(add.profileName === profileName, "expected repo-aware stripe profile");
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
    "stripe-test",
    "--profile",
    profileName,
    "--json"
  );
  assert(check.ok === true, "expected Stripe test fixture policy-covered");
  assert(check.policyCovered === true, "expected policy-covered Stripe fixture");
  assert(check.counts?.allowedSensitive === 0, "expected no allowed-sensitive tools");
  assert(check.counts?.notAllowed === 0, "expected no not-allowed tools");
  assert(check.counts?.allowed === 5, "expected read and fixture tools allowed");
  assert(check.counts?.approvalRequired === 6, "expected money-shaped writes gated");
  assert(check.counts?.denied === 8, "expected live/admin/secret tools denied");
  assertToolClass(check, `${profileName}_list_customers`, "allowed");
  assertToolClass(check, `${profileName}_get_payment_intent`, "allowed");
  assertToolClass(check, `${profileName}_search_charges`, "allowed");
  assertToolClass(check, `${profileName}_create_customer`, "approval_required");
  assertToolClass(check, `${profileName}_update_subscription`, "approval_required");
  assertToolClass(check, `${profileName}_refund_charge`, "approval_required");
  assertToolClass(check, `${profileName}_cancel_subscription`, "approval_required");
  assertToolClass(check, `${profileName}_capture_payment_intent`, "approval_required");
  assertToolClass(check, `${profileName}_confirm_payment_intent`, "approval_required");
  assertToolClass(check, `${profileName}_live_charges`, "denied");
  assertToolClass(check, `${profileName}_production_balance`, "denied");
  assertToolClass(check, `${profileName}_payout_create`, "denied");
  assertToolClass(check, `${profileName}_transfer_create`, "denied");
  assertToolClass(check, `${profileName}_account_update`, "denied");
  assertToolClass(check, `${profileName}_webhook_secret_create`, "denied");
  assertToolClass(check, `${profileName}_token_create`, "denied");
  assertToolClass(check, `${profileName}_secret_status`, "denied");
  assertNoSecretText(JSON.stringify(check), "preset check");

  const mandate = runCliJson(
    "mandate",
    "create",
    "--from",
    "stripe-test",
    "--json"
  );
  assert(
    mandate.mandate?.id === "inspect-test-payments",
    "expected template task id"
  );
  assert(mandate.mandate?.profiles?.[0] === profileName, "expected inferred profile");
  assert(mandate.mandate?.branch === "payments", "expected current branch");
  assert(
    mandate.mandate?.deniedTools?.includes?.(`${profileName}_*live*`),
    "expected live tools denied"
  );
  assert(
    mandate.mandate?.approvalGates?.some?.(
      (gate) => gate.toolPattern === `${profileName}_refund*`
    ),
    "expected refund approval gate"
  );
  assertNoSecretText(JSON.stringify(mandate), "mandate create");

  const tools = runCliJson("tools", "--mandate", "inspect-test-payments", "--json");
  assert(
    tools.tools?.some?.((tool) => tool.name === `${profileName}_echo`),
    "expected stripe test tool surface"
  );
  assertNoSecretText(JSON.stringify(tools), "tool surface");

  const report = runCliJson("mandate", "report", "inspect-test-payments", "--json");
  assert(
    report.readiness?.selectedCanHandoff === true,
    "expected stripe test mandate ready for handoff"
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

function safeIdentifier(value) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "repo";
}

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
