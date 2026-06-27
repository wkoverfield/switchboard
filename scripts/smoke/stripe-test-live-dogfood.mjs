#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";

const repo = resolve(import.meta.dirname, "..", "..");
const cliPath = join(repo, "apps/cli/dist/index.js");
const outputDir = join(repo, ".switchboard-live-dogfood");
const enabled = process.env.SWITCHBOARD_LIVE_PROVIDER_DOGFOOD === "1";
const stripeKey =
  process.env.SWITCHBOARD_STRIPE_TEST_KEY ??
  process.env.STRIPE_TEST_SECRET_KEY ??
  "";

if (!enabled) {
  process.stdout.write(
    [
      "Skipped live Stripe test dogfood.",
      "Set SWITCHBOARD_LIVE_PROVIDER_DOGFOOD=1 and SWITCHBOARD_STRIPE_TEST_KEY=<restricted test key> to run it.",
      ""
    ].join("\n")
  );
  process.exit(0);
}

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:stripe-test-live-dogfood`."
  );
}

if (!stripeKey) {
  throw new Error(
    "Missing SWITCHBOARD_STRIPE_TEST_KEY or STRIPE_TEST_SECRET_KEY for live Stripe test dogfood."
  );
}

if (/^sk_live_/i.test(stripeKey) || /^rk_live_/i.test(stripeKey)) {
  throw new Error("Refusing to run stripe-test dogfood with a live-mode Stripe key.");
}

if (!/^(sk|rk)_test_/i.test(stripeKey)) {
  throw new Error(
    "Refusing to run stripe-test dogfood without an explicit sk_test_ or rk_test_ key."
  );
}

const project = mkdtempSync(join(tmpdir(), "switchboard-stripe-live-"));
const repoSlug = safeIdentifier(basename(project));
const profileName = `stripe_${repoSlug}_test`;
const secretRef = `stripe/${repoSlug}/test/secret-key`;
let reportPath = "";

try {
  run("git", ["init", "-b", "payments"], { cwd: project });
  writeFileSync(join(project, ".gitignore"), ".switchboard.local.yaml\n");

  const setup = runCliJson(["setup", "stripe-test", "--value-stdin", "--json"], {
    input: stripeKey
  });
  assertNoSecretText(JSON.stringify(setup), "setup JSON");
  assert(
    setup.profileName === profileName,
    `expected repo-aware profile ${profileName}`
  );

  const doctor = runCliJson(["doctor", "--json"]);
  assertNoSecretText(JSON.stringify(doctor), "doctor JSON");

  const check = runCliJson([
    "presets",
    "check",
    "stripe-test",
    "--profile",
    profileName,
    "--timeout-ms",
    "60000",
    "--json"
  ]);
  assertNoSecretText(JSON.stringify(check), "preset check JSON");

  const summary = {
    schemaVersion: "switchboard.live-provider-dogfood.v1",
    providerPreset: "stripe-test",
    generatedAt: new Date().toISOString(),
    repoPath: project,
    profileName,
    secretRef,
    check: {
      ok: check.ok,
      policyCovered: check.policyCovered,
      counts: check.counts,
      allowedSensitive: check.counts?.allowedSensitive ?? null,
      notAllowed: check.counts?.notAllowed ?? null,
      nextActions: check.nextActions ?? []
    },
    classifications: summarizeClassifications(check.tools ?? []),
    mandate: null,
    report: null,
    result: "needs-policy-review"
  };

  if (!check.policyCovered || check.counts?.allowedSensitive !== 0) {
    writeSummary(summary);
    throw new Error(
      `Stripe preset check is not policy-covered. Review ${reportPath}.`
    );
  }

  const mandate = runCliJson([
    "mandate",
    "create",
    "--from",
    "stripe-test",
    "--json"
  ]);
  assertNoSecretText(JSON.stringify(mandate), "mandate JSON");

  const tools = runCliJson([
    "tools",
    "--mandate",
    "inspect-test-payments",
    "--json"
  ]);
  assertNoSecretText(JSON.stringify(tools), "tool surface JSON");

  const mandateReport = runCliJson([
    "mandate",
    "report",
    "inspect-test-payments",
    "--json"
  ]);
  assertNoSecretText(JSON.stringify(mandateReport), "mandate report JSON");

  summary.mandate = {
    id: mandate.mandate?.id ?? null,
    branch: mandate.mandate?.branch ?? null,
    lease: mandate.mandate?.lease ?? null,
    profiles: mandate.mandate?.profiles ?? [],
    deniedTools: mandate.mandate?.deniedTools ?? [],
    approvalGateCount: mandate.mandate?.approvalGates?.length ?? 0,
    workspaceLeaseSchemaVersion: mandate.workspaceLease?.schemaVersion ?? null,
    mcpLaunchSchemaVersion: mandate.mcpLaunch?.schemaVersion ?? null
  };
  summary.report = {
    schemaVersion: mandateReport.schemaVersion ?? null,
    selectedCanHandoff: mandateReport.readiness?.selectedCanHandoff ?? null,
    blockerCount: mandateReport.readiness?.blockers?.length ?? null,
    warningCount: mandateReport.readiness?.warnings?.length ?? null,
    toolCount: tools.tools?.length ?? null
  };
  summary.result = "passed";
  writeSummary(summary);
  process.stdout.write(`Live Stripe test dogfood passed. Redacted summary: ${reportPath}\n`);
} finally {
  runCli(["secrets", "remove", secretRef], { allowFailure: true });
  rmSync(project, { force: true, recursive: true });
}

function runCliJson(args, options = {}) {
  const result = runCli(args, options);
  if (result.status !== 0) {
    throw new Error(
      `switchboard ${args.join(" ")} failed\nstdout:\n${redactSecret(result.stdout)}\nstderr:\n${redactSecret(result.stderr)}`
    );
  }
  assertNoSecretLeak(result, `switchboard ${args.join(" ")}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

function runCli(args, options = {}) {
  const result = run(process.execPath, [cliPath, "--cwd", project, ...args], {
    cwd: repo,
    input: options.input,
    env: smokeEnv(),
    timeout: 180_000
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

function writeSummary(summary) {
  mkdirSync(outputDir, { recursive: true });
  reportPath = join(
    outputDir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-stripe-test.json`
  );
  const text = redactSecret(JSON.stringify(summary, null, 2));
  assertNoSecretText(text, "summary file");
  writeFileSync(reportPath, `${text}\n`);
}

function summarizeClassifications(tools) {
  const byClassification = {};
  for (const tool of tools) {
    const classification = tool.classification ?? "unknown";
    byClassification[classification] ??= [];
    byClassification[classification].push(tool.toolName);
  }
  return byClassification;
}

function assertNoSecretLeak(result, label) {
  assertNoSecretText(result.stdout, `${label} stdout`);
  assertNoSecretText(result.stderr, `${label} stderr`);
}

function assertNoSecretText(value, label) {
  assert(!value.includes(stripeKey), `${label} printed Stripe key`);
}

function redactSecret(value) {
  return stripeKey ? value.replaceAll(stripeKey, "[redacted]") : value;
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
    throw new Error(message);
  }
}
