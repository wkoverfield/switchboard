#!/usr/bin/env node
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
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
const mcpSdkPath = join(
  repo,
  "packages/mcp-runtime/node_modules/@modelcontextprotocol/sdk"
);
const { Client } = await import(join(mcpSdkPath, "dist/esm/client/index.js"));
const { StdioClientTransport } = await import(
  join(mcpSdkPath, "dist/esm/client/stdio.js")
);
const project = mkdtempSync(join(tmpdir(), "switchboard-vercel-preview-"));
const repoSlug = safeIdentifier(basename(project));
const profileName = `vercel_${repoSlug}_preview`;
const secretRef = `vercel/${repoSlug}/preview/token`;
const secretValue = "vercel-preview-secret-do-not-print";
const secretHash = sha256(secretValue);
const unmountedSecretRef = `vercel/${repoSlug}/preview/unmounted-token`;
const unmountedSecretValue = "vercel-preview-unmounted-secret-do-not-print";
const mandateId = "inspect-preview";
const allowedReadTool = `${profileName}_list_deployments`;
const approvalDeployTool = `${profileName}_create_deployment`;
const approvalRollbackTool = `${profileName}_rollback_deployment`;
const deniedProductionTool = `${profileName}_deploy_prod`;
const fixtureCliPath = join(project, "fixture");
const fixtureCallLogPath = join(project, "fixture-tool-calls.log");
const runtimeDir = join(project, "runtime");
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
  writeFixtureCli();

  const add = runCliJson(
    "add",
    "vercel-preview",
    "--command",
    process.execPath,
    "--arg",
    fixtureServerPath,
    "--arg",
    profileName,
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
  appendRunModeEnvGuards();

  const setSecret = runCli(
    ["secrets", "set", secretRef, "--value-stdin", "--json"],
    secretValue
  );
  assert(setSecret.status === 0, "expected secret set to succeed");
  assertNoSecretLeak(setSecret, "secret set");
  const setUnmountedSecret = runCli(
    ["secrets", "set", unmountedSecretRef, "--value-stdin", "--json"],
    unmountedSecretValue
  );
  assert(setUnmountedSecret.status === 0, "expected unmounted secret set to succeed");
  assertNoSecretLeak(setUnmountedSecret, "unmounted secret set");

  const check = runCliJson(
    "presets",
    "check",
    "vercel-preview",
    "--profile",
    profileName,
    "--json"
  );
  assert(check.ok === true, "expected Vercel preview policy to cover fixture tools");
  assert(check.policyCovered === true, "expected policy-covered Vercel fixture");
  assert(check.counts?.allowedSensitive === 0, "expected no allowed-sensitive tools");
  assert(check.counts?.notAllowed === 0, "expected no not-allowed tools");
  assert(check.counts?.allowed === 6, "expected echo, whoami, and read/log tools allowed");
  assert(check.counts?.approvalRequired === 4, "expected deployment write/rollback approval gates");
  assert(check.counts?.denied === 12, "expected production/admin tools denied");
  assertToolClass(check, `${profileName}_list_deployments`, "allowed");
  assertToolClass(check, `${profileName}_get_deployment`, "allowed");
  assertToolClass(check, `${profileName}_get_deployment_events`, "allowed");
  assertToolClass(check, `${profileName}_get_runtime_logs`, "allowed");
  assertToolClass(check, `${profileName}_create_deployment`, "approval_required");
  assertToolClass(check, `${profileName}_cancel_deployment`, "approval_required");
  assertToolClass(check, `${profileName}_delete_deployment`, "approval_required");
  assertToolClass(check, `${profileName}_rollback_deployment`, "approval_required");
  assertToolClass(check, `${profileName}_deploy_prod`, "denied");
  assertToolClass(check, `${profileName}_deploy_production`, "denied");
  assertToolClass(check, `${profileName}_env_list`, "denied");
  assertToolClass(check, `${profileName}_create_env`, "denied");
  assertToolClass(check, `${profileName}_environment_update`, "denied");
  assertToolClass(check, `${profileName}_domains_list`, "denied");
  assertToolClass(check, `${profileName}_domain_add`, "denied");
  assertToolClass(check, `${profileName}_secret_status`, "denied");
  assertToolClass(check, `${profileName}_billing_list`, "denied");
  assertToolClass(check, `${profileName}_team_members`, "denied");
  assertNoSecretText(JSON.stringify(check), "preset check");

  const mandate = runCliJson(
    "mandate",
    "create",
    "--from",
    "vercel-preview",
    "--profiles",
    profileName,
    "--json"
  );
  assert(mandate.mandate?.id === "inspect-preview", "expected template task id");
  assert(mandate.mandate?.branch === "preview", "expected current branch");
  assert(
    mandate.mandate?.deniedTools?.includes?.(`${profileName}_deploy_prod`),
    "expected production deploy denied"
  );
  assert(
    mandate.mandate?.approvalGates?.some?.(
      (gate) => gate.toolPattern === `${profileName}_create_deployment`
    ),
    "expected create deployment approval gate"
  );
  assertNoSecretText(JSON.stringify(mandate), "mandate create");

  const tools = runCliJson("tools", "--mandate", mandateId, "--json");
  assert(
    tools.tools?.some?.((tool) => tool.name === `${profileName}_echo`),
    "expected preview tool surface"
  );
  assert(
    tools.tools?.some?.(
      (tool) =>
        tool.name === approvalDeployTool &&
        tool._meta?.switchboard?.approvalRequired?.risk === "medium"
    ),
    "expected approval-gated Vercel deploy tool metadata"
  );
  assert(
    !tools.tools?.some?.((tool) => tool.name === deniedProductionTool),
    "expected denied production deploy hidden from preview tool surface"
  );
  assertNoSecretText(JSON.stringify(tools), "tool surface");

  assertMandateRunSeesSecret();
  await assertVercelAuthorityPack();

  const logs = runCliJson("logs", "--mandate", mandateId, "--json");
  assert(
    logs.entries?.some?.(
      (entry) =>
        entry.action === "command_run" &&
        entry.mandateId === mandateId &&
        entry.envKeys?.includes?.("VERCEL_TOKEN")
    ),
    "expected Vercel run audit entry"
  );
  assert(
    logs.entries?.some?.(
      (entry) =>
        entry.toolName === approvalDeployTool &&
        entry.approvalRequestId &&
        entry.error?.includes?.("approval")
    ),
    "expected approval-required Vercel deploy audit entry"
  );
  assert(
    logs.entries?.some?.(
      (entry) =>
        entry.toolName === deniedProductionTool &&
        entry.error?.includes?.("denied")
    ),
    "expected denied production deploy audit entry"
  );
  assertNoSecretText(JSON.stringify(logs), "logs");
  assertNoSecretText(readAuditLog(), "raw audit log");

  const report = runCliJson("mandate", "report", mandateId, "--json");
  assert(
    report.readiness?.selectedCanHandoff === true,
    "expected preview mandate ready for handoff"
  );
  assert(
    report.counts?.approvalRequests === 2,
    "expected denied and approved approval requests in preview report"
  );
  assert(
    report.approvalRequests?.some?.(
      (request) =>
        request.toolName === approvalDeployTool &&
        request.runtimeStatus === "denied"
    ),
    "expected denied Vercel deploy approval request in report"
  );
  assert(
    report.approvalRequests?.some?.(
      (request) =>
        request.toolName === approvalRollbackTool &&
        request.runtimeStatus === "approved"
    ),
    "expected approved Vercel rollback approval request in report"
  );
  assert(
    report.auditEntries?.some?.((entry) => entry.toolName === deniedProductionTool),
    "expected denied production deploy audit entry in report"
  );
  assertNoSecretText(JSON.stringify(report), "mandate report");
} finally {
  runCli(["daemon", "stop", "--json"], undefined, { allowFailure: true });
  runCli(["secrets", "remove", secretRef], undefined, { allowFailure: true });
  runCli(["secrets", "remove", unmountedSecretRef], undefined, { allowFailure: true });
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
    SWITCHBOARD_RUNTIME_DIR: runtimeDir,
    TS_KEYRING_BACKEND: "file",
    SWITCHBOARD_ALLOW_UNSAFE_SECRET_BACKENDS: "1",
    SWITCHBOARD_FIXTURE_CALL_LOG: fixtureCallLogPath
  };
}

function assertNoSecretLeak(result, label) {
  assertNoSecretText(result.stdout, `${label} stdout`);
  assertNoSecretText(result.stderr, `${label} stderr`);
  assertNoSecretText(result.stdout, `${label} stdout unmounted`, unmountedSecretValue);
  assertNoSecretText(result.stderr, `${label} stderr unmounted`, unmountedSecretValue);
}

function assertNoSecretText(value, label, secret = secretValue) {
  assert(!value.includes(secret), `${label} printed secret value`);
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
  return value
    .replaceAll(secretValue, "[redacted]")
    .replaceAll(unmountedSecretValue, "[redacted]");
}

async function assertVercelAuthorityPack() {
  const client = new Client({
    name: "switchboard-vercel-preview-authority-pack-smoke",
    version: "0.1.0"
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "--cwd", project, "mcp", "--mandate", mandateId],
    cwd: repo,
    env: smokeEnv(),
    stderr: "pipe"
  });

  let mcpStderr = "";
  transport.stderr?.on("data", (chunk) => {
    mcpStderr += chunk.toString();
  });

  try {
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert(
        tools.tools.some((tool) => tool.name === allowedReadTool),
        "expected allowed Vercel preview read tool in MCP list"
      );
      const gatedTool = tools.tools.find(
        (tool) => tool.name === approvalDeployTool
      );
      assert(gatedTool, "expected approval-gated Vercel deploy tool in MCP list");
      assert(
        gatedTool._meta?.switchboard?.approvalRequired?.risk === "medium" &&
          gatedTool._meta?.switchboard?.approvalRequired?.labels?.includes?.(
            "vercel"
          ),
        "expected Vercel deploy approval metadata"
      );
      assert(
        !tools.tools.some((tool) => tool.name === deniedProductionTool),
        "expected denied production deploy hidden from MCP list"
      );

      const readResult = await client.callTool({
        name: allowedReadTool,
        arguments: { message: "preview" }
      });
      assert(
        textContent(readResult) === `${profileName}:list_deployments:preview`,
        "expected allowed Vercel read call to route upstream"
      );
      assertToolCallCount("list_deployments", 1);

      const deployBlock = await captureResult(() =>
        client.callTool({
          name: approvalDeployTool,
          arguments: { message: "deploy" }
        })
      );
      assert(
        deployBlock.error || deployBlock.result?.isError === true,
        "expected Vercel deploy call to require approval before upstream execution"
      );
      assertToolCallCount("create_deployment", 0);
      const deployApprovals = runCliJson(
        "approvals",
        "--mandate",
        mandateId,
        "--json"
      );
      const deployRequest = deployApprovals.requests?.find?.(
        (request) =>
          request.toolName === approvalDeployTool &&
          request.runtimeStatus === "pending"
      );
      assert(deployRequest, "expected pending approval request for Vercel deploy");
      const denied = runCliJson(
        "deny",
        deployRequest.id,
        "--reason",
        "do not create preview deployments during fixture proof",
        "--json"
      );
      assert(
        denied.request?.runtimeStatus === "denied",
        "expected denied Vercel deploy approval request"
      );
      assertToolCallCount("create_deployment", 0);

      const rollbackBlock = await captureResult(() =>
        client.callTool({
          name: approvalRollbackTool,
          arguments: { message: "rollback" }
        })
      );
      assert(
        rollbackBlock.error || rollbackBlock.result?.isError === true,
        "expected Vercel rollback call to require approval before upstream execution"
      );
      assertToolCallCount("rollback_deployment", 0);
      const rollbackApprovals = runCliJson(
        "approvals",
        "--mandate",
        mandateId,
        "--json"
      );
      const rollbackRequest = rollbackApprovals.requests?.find?.(
        (request) =>
          request.toolName === approvalRollbackTool &&
          request.runtimeStatus === "pending"
      );
      assert(rollbackRequest, "expected pending approval request for Vercel rollback");
      const approved = runCliJson(
        "approve",
        rollbackRequest.id,
        "--reason",
        "preview rollback approved for fixture proof",
        "--json"
      );
      assert(
        approved.request?.runtimeStatus === "approved",
        "expected approved Vercel rollback approval request"
      );
      const approvedRollback = await client.callTool({
        name: approvalRollbackTool,
        arguments: { message: "rollback" }
      });
      assert(
        textContent(approvedRollback) ===
          `${profileName}:rollback_deployment:rollback`,
        "expected approved Vercel rollback call to route upstream"
      );
      assertToolCallCount("rollback_deployment", 1);

      const deniedCall = await captureResult(() =>
        client.callTool({
          name: deniedProductionTool,
          arguments: { message: "prod" }
        })
      );
      assert(
        deniedCall.error || deniedCall.result?.isError === true,
        "expected production deploy call to stay blocked"
      );
      assertToolCallCount("deploy_prod", 0);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nMCP stderr:\n${redactSecret(mcpStderr)}`
      );
    }
  } finally {
    await client.close().catch(() => {});
  }

  assertNoSecretText(mcpStderr, "mcp stderr");
}

function assertMandateRunSeesSecret() {
  const result = runCliJson(
    "run",
    "--mandate",
    mandateId,
    "--json",
    fixtureCliPath,
    "deployments"
  );
  assert(result.ok === true, "expected Vercel run mode to succeed");
  assert(
    JSON.stringify(result.envKeys) === JSON.stringify(["VERCEL_TOKEN"]),
    "expected exact scoped Vercel token env key"
  );
  const child = JSON.parse(result.stdout);
  assert(child.hasVercelToken === true, "expected run mode to inject Vercel token");
  assert(child.rawSecret === null, "expected raw unscoped env to stay absent");
  assert(child.literalEnv === null, "expected literal profile env to stay absent");
  assert(
    child.unmountedVercelToken === null,
    "expected unmounted profile secret to stay absent"
  );
  assert(child.argv?.[0] === "deployments", "expected fixture CLI argument");
  assertNoSecretText(JSON.stringify(result), "run mode result");
  assertNoSecretText(
    JSON.stringify(result),
    "run mode result unmounted secret",
    unmountedSecretValue
  );
}

function writeFixtureCli() {
  writeFileSync(
    fixtureCliPath,
    [
      "#!/bin/sh",
      "has=false",
      "[ -n \"$VERCEL_TOKEN\" ] && has=true",
      "raw=null",
      "[ -n \"$RAW_SECRET\" ] && raw='\"present\"'",
      "literal=null",
      "[ -n \"$VERCEL_LITERAL_ENV\" ] && literal='\"present\"'",
      "unmounted=null",
      "[ -n \"$UNMOUNTED_VERCEL_TOKEN\" ] && unmounted='\"present\"'",
      "printf '{\"argv\":[\"%s\"],\"hasVercelToken\":%s,\"rawSecret\":%s,\"literalEnv\":%s,\"unmountedVercelToken\":%s}\\n' \"$1\" \"$has\" \"$raw\" \"$literal\" \"$unmounted\""
    ].join("\n")
  );
  chmodSync(fixtureCliPath, 0o755);
}

function appendRunModeEnvGuards() {
  const configPath = join(project, ".switchboard.yaml");
  const existing = readFileSync(configPath, "utf8");
  const withLiteral = existing.replace(
    `        VERCEL_TOKEN:\n          secretRef: ${secretRef}`,
    [
      `        VERCEL_TOKEN:`,
      `          secretRef: ${secretRef}`,
      `        SWITCHBOARD_FIXTURE_CALL_LOG: ${JSON.stringify(fixtureCallLogPath)}`,
      `        VERCEL_LITERAL_ENV: literal_should_not_be_injected`
    ].join("\n")
  );
  const unmountedProfile = [
    `  vercel_${repoSlug}_unmounted:`,
    `    provider: vercel`,
    `    namespace: vercel_${repoSlug}_unmounted`,
    `    upstream:`,
    `      type: stdio`,
    `      command: fixture-unmounted`,
    `      env:`,
    `        UNMOUNTED_VERCEL_TOKEN:`,
    `          secretRef: ${unmountedSecretRef}`,
    ""
  ].join("\n");
  writeFileSync(
    configPath,
    withLiteral.replace("workspaces:\n", `${unmountedProfile}workspaces:\n`)
  );
}

async function captureResult(run) {
  try {
    return { result: await run() };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

function assertToolCallCount(toolName, expectedCount) {
  const text = existsSync(fixtureCallLogPath)
    ? readFileSync(fixtureCallLogPath, "utf8")
    : "";
  const count = text
    .split("\n")
    .filter((line) => line.trim() === toolName).length;
  assert(
    count === expectedCount,
    `expected ${toolName} to be called ${expectedCount} time(s), got ${count}`
  );
}

function readAuditLog() {
  return readFileSync(
    join(project, "xdg-state", "switchboard", "logs", "switchboard.jsonl"),
    "utf8"
  );
}

function textContent(result) {
  if (!Array.isArray(result.content)) {
    return "";
  }
  const first = result.content[0];
  return first?.type === "text" && typeof first.text === "string"
    ? first.text
    : "";
}

function safeIdentifier(value) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : "repo";
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
