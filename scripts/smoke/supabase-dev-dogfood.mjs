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
const project = mkdtempSync(join(tmpdir(), "switchboard-supabase-dev-"));
const repoSlug = safeIdentifier(basename(project));
const profileName = `supabase_${repoSlug}_dev`;
const secretRef = `supabase/${repoSlug}/dev/access-token`;
const secretValue = "supabase-dev-secret-do-not-print";
const secretHash = sha256(secretValue);
const unmountedSecretRef = `supabase/${repoSlug}/dev/unmounted-token`;
const unmountedSecretValue = "supabase-dev-unmounted-secret-do-not-print";
const mandateId = "inspect-dev-db";
const allowedReadTool = `${profileName}_list_tables`;
const approvalSqlTool = `${profileName}_execute_sql`;
const approvalMigrationTool = `${profileName}_apply_migration`;
const deniedDropTool = `${profileName}_drop_table`;
const fixtureCliPath = join(project, "fixture");
const fixtureCallLogPath = join(project, "fixture-tool-calls.log");
const runtimeDir = join(project, "runtime");
const providerToolNames = [
  "list_tables",
  "get_schema",
  "select_rows",
  "get_logs",
  "execute_sql",
  "apply_migration",
  "create_table",
  "insert_rows",
  "update_rows",
  "upsert_rows",
  "set_config",
  "delete_rows",
  "drop_table",
  "truncate_table",
  "production_query",
  "service_role_status",
  "admin_update",
  "token_create"
];

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:supabase-dev-dogfood`."
  );
}

try {
  run("git", ["init", "-b", "db/inspect"], { cwd: project });
  writeFileSync(join(project, ".gitignore"), ".switchboard.local.yaml\n");
  writeFixtureCli();

  const add = runCliJson(
    "add",
    "supabase-dev",
    "--command",
    process.execPath,
    "--arg",
    fixtureServerPath,
    "--arg",
    profileName,
    "--arg",
    "SUPABASE_ACCESS_TOKEN",
    "--arg",
    secretHash,
    ...providerToolNames.flatMap((toolName) => ["--arg", toolName]),
    "--write",
    "--json"
  );
  assert(add.action === "created", "expected supabase-dev add to create config");
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
    "supabase-dev",
    "--profile",
    profileName,
    "--json"
  );
  assert(check.ok === true, "expected Supabase dev policy to cover fixture tools");
  assert(check.policyCovered === true, "expected policy-covered Supabase fixture");
  assert(check.counts?.allowedSensitive === 0, "expected no allowed-sensitive tools");
  assert(check.counts?.notAllowed === 0, "expected no not-allowed tools");
  assert(check.counts?.allowed === 6, "expected echo, whoami, and read/log tools allowed");
  assert(check.counts?.approvalRequired === 7, "expected SQL/write/schema approval gates");
  assert(check.counts?.denied === 8, "expected destructive/admin/prod tools denied");
  assertToolClass(check, `${profileName}_list_tables`, "allowed");
  assertToolClass(check, `${profileName}_get_schema`, "allowed");
  assertToolClass(check, `${profileName}_select_rows`, "allowed");
  assertToolClass(check, `${profileName}_get_logs`, "allowed");
  assertToolClass(check, `${profileName}_execute_sql`, "approval_required");
  assertToolClass(check, `${profileName}_apply_migration`, "approval_required");
  assertToolClass(check, `${profileName}_insert_rows`, "approval_required");
  assertToolClass(check, `${profileName}_update_rows`, "approval_required");
  assertToolClass(check, `${profileName}_delete_rows`, "denied");
  assertToolClass(check, `${profileName}_drop_table`, "denied");
  assertToolClass(check, `${profileName}_truncate_table`, "denied");
  assertToolClass(check, `${profileName}_production_query`, "denied");
  assertToolClass(check, `${profileName}_service_role_status`, "denied");
  assertToolClass(check, `${profileName}_admin_update`, "denied");
  assertToolClass(check, `${profileName}_token_create`, "denied");
  assertToolClass(check, `${profileName}_secret_status`, "denied");
  assertNoSecretText(JSON.stringify(check), "preset check");

  const mandate = runCliJson(
    "mandate",
    "create",
    "--from",
    "supabase-dev",
    "--profiles",
    profileName,
    "--json"
  );
  assert(mandate.mandate?.id === mandateId, "expected template task id");
  assert(mandate.mandate?.branch === "db/inspect", "expected current branch");
  assert(
    mandate.mandate?.deniedTools?.includes?.(`${profileName}_drop*`),
    "expected drop tools denied"
  );
  assert(
    mandate.mandate?.approvalGates?.some?.(
      (gate) => gate.toolPattern === `${profileName}_execute_sql`
    ),
    "expected arbitrary SQL approval gate"
  );
  assertNoSecretText(JSON.stringify(mandate), "mandate create");

  const tools = runCliJson("tools", "--mandate", mandateId, "--json");
  assert(
    tools.tools?.some?.((tool) => tool.name === `${profileName}_echo`),
    "expected Supabase dev tool surface"
  );
  assert(
    tools.tools?.some?.(
      (tool) =>
        tool.name === approvalSqlTool &&
        tool._meta?.switchboard?.approvalRequired?.risk === "high"
    ),
    "expected approval-gated SQL tool metadata"
  );
  assert(
    !tools.tools?.some?.((tool) => tool.name === deniedDropTool),
    "expected denied drop tool hidden from dev database surface"
  );
  assertNoSecretText(JSON.stringify(tools), "tool surface");

  assertMandateRunSeesSecret();
  await assertSupabaseAuthorityPack();

  const logs = runCliJson("logs", "--mandate", mandateId, "--json");
  assert(
    logs.entries?.some?.(
      (entry) =>
        entry.action === "command_run" &&
        entry.mandateId === mandateId &&
        entry.envKeys?.includes?.("SUPABASE_ACCESS_TOKEN")
    ),
    "expected Supabase run audit entry"
  );
  assert(
    logs.entries?.some?.(
      (entry) =>
        entry.toolName === approvalSqlTool &&
        entry.approvalRequestId &&
        entry.error?.includes?.("approval")
    ),
    "expected approval-required SQL audit entry"
  );
  assert(
    logs.entries?.some?.(
      (entry) =>
        entry.toolName === deniedDropTool &&
        entry.error?.includes?.("denied")
    ),
    "expected denied drop audit entry"
  );
  assertNoSecretText(JSON.stringify(logs), "logs");
  assertNoSecretText(readAuditLog(), "raw audit log");

  const report = runCliJson("mandate", "report", mandateId, "--json");
  assert(
    report.readiness?.selectedCanHandoff === true,
    "expected Supabase mandate ready for handoff"
  );
  assert(
    report.counts?.approvalRequests === 2,
    "expected denied and approved approval requests in Supabase report"
  );
  assert(
    report.approvalRequests?.some?.(
      (request) =>
        request.toolName === approvalSqlTool &&
        request.runtimeStatus === "denied"
    ),
    "expected denied SQL approval request in report"
  );
  assert(
    report.approvalRequests?.some?.(
      (request) =>
        request.toolName === approvalMigrationTool &&
        request.runtimeStatus === "approved"
    ),
    "expected approved migration approval request in report"
  );
  assert(
    report.auditEntries?.some?.((entry) => entry.toolName === deniedDropTool),
    "expected denied drop audit entry in report"
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

async function assertSupabaseAuthorityPack() {
  const client = new Client({
    name: "switchboard-supabase-dev-authority-pack-smoke",
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
        "expected allowed Supabase read tool in MCP list"
      );
      const gatedTool = tools.tools.find((tool) => tool.name === approvalSqlTool);
      assert(gatedTool, "expected approval-gated SQL tool in MCP list");
      assert(
        gatedTool._meta?.switchboard?.approvalRequired?.risk === "high" &&
          gatedTool._meta?.switchboard?.approvalRequired?.labels?.includes?.(
            "database"
          ),
        "expected Supabase SQL approval metadata"
      );
      assert(
        !tools.tools.some((tool) => tool.name === deniedDropTool),
        "expected denied drop tool hidden from MCP list"
      );

      const readResult = await client.callTool({
        name: allowedReadTool,
        arguments: { message: "tables" }
      });
      assert(
        textContent(readResult) === `${profileName}:list_tables:tables`,
        "expected allowed Supabase read call to route upstream"
      );
      assertToolCallCount("list_tables", 1);

      const sqlBlock = await captureResult(() =>
        client.callTool({
          name: approvalSqlTool,
          arguments: { message: "select 1" }
        })
      );
      assert(
        sqlBlock.error || sqlBlock.result?.isError === true,
        "expected SQL call to require approval before upstream execution"
      );
      assertToolCallCount("execute_sql", 0);
      const sqlApprovals = runCliJson(
        "approvals",
        "--mandate",
        mandateId,
        "--json"
      );
      const sqlRequest = sqlApprovals.requests?.find?.(
        (request) =>
          request.toolName === approvalSqlTool &&
          request.runtimeStatus === "pending"
      );
      assert(sqlRequest, "expected pending approval request for SQL");
      const denied = runCliJson(
        "deny",
        sqlRequest.id,
        "--reason",
        "do not run arbitrary SQL during fixture proof",
        "--json"
      );
      assert(
        denied.request?.runtimeStatus === "denied",
        "expected denied SQL approval request"
      );
      assertToolCallCount("execute_sql", 0);

      const migrationBlock = await captureResult(() =>
        client.callTool({
          name: approvalMigrationTool,
          arguments: { message: "migration" }
        })
      );
      assert(
        migrationBlock.error || migrationBlock.result?.isError === true,
        "expected migration call to require approval before upstream execution"
      );
      assertToolCallCount("apply_migration", 0);
      const migrationApprovals = runCliJson(
        "approvals",
        "--mandate",
        mandateId,
        "--json"
      );
      const migrationRequest = migrationApprovals.requests?.find?.(
        (request) =>
          request.toolName === approvalMigrationTool &&
          request.runtimeStatus === "pending"
      );
      assert(migrationRequest, "expected pending approval request for migration");
      const approved = runCliJson(
        "approve",
        migrationRequest.id,
        "--reason",
        "dev migration approved for fixture proof",
        "--json"
      );
      assert(
        approved.request?.runtimeStatus === "approved",
        "expected approved migration approval request"
      );
      const approvedMigration = await client.callTool({
        name: approvalMigrationTool,
        arguments: { message: "migration" }
      });
      assert(
        textContent(approvedMigration) ===
          `${profileName}:apply_migration:migration`,
        "expected approved migration call to route upstream"
      );
      assertToolCallCount("apply_migration", 1);

      const deniedCall = await captureResult(() =>
        client.callTool({
          name: deniedDropTool,
          arguments: { message: "drop" }
        })
      );
      assert(
        deniedCall.error || deniedCall.result?.isError === true,
        "expected drop table call to stay blocked"
      );
      assertToolCallCount("drop_table", 0);
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
    "tables"
  );
  assert(result.ok === true, "expected Supabase run mode to succeed");
  assert(
    JSON.stringify(result.envKeys) === JSON.stringify(["SUPABASE_ACCESS_TOKEN"]),
    "expected exact scoped Supabase token env key"
  );
  const child = JSON.parse(result.stdout);
  assert(child.hasSupabaseToken === true, "expected run mode to inject Supabase token");
  assert(child.rawSecret === null, "expected raw unscoped env to stay absent");
  assert(child.literalEnv === null, "expected literal profile env to stay absent");
  assert(
    child.unmountedSupabaseToken === null,
    "expected unmounted profile secret to stay absent"
  );
  assert(child.argv?.[0] === "tables", "expected fixture CLI argument");
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
      "[ -n \"$SUPABASE_ACCESS_TOKEN\" ] && has=true",
      "raw=null",
      "[ -n \"$RAW_SECRET\" ] && raw='\"present\"'",
      "literal=null",
      "[ -n \"$SUPABASE_LITERAL_ENV\" ] && literal='\"present\"'",
      "unmounted=null",
      "[ -n \"$UNMOUNTED_SUPABASE_TOKEN\" ] && unmounted='\"present\"'",
      "printf '{\"argv\":[\"%s\"],\"hasSupabaseToken\":%s,\"rawSecret\":%s,\"literalEnv\":%s,\"unmountedSupabaseToken\":%s}\\n' \"$1\" \"$has\" \"$raw\" \"$literal\" \"$unmounted\""
    ].join("\n")
  );
  chmodSync(fixtureCliPath, 0o755);
}

function appendRunModeEnvGuards() {
  const configPath = join(project, ".switchboard.yaml");
  const existing = readFileSync(configPath, "utf8");
  const withLiteral = existing.replace(
    `        SUPABASE_ACCESS_TOKEN:\n          secretRef: ${secretRef}`,
    [
      `        SUPABASE_ACCESS_TOKEN:`,
      `          secretRef: ${secretRef}`,
      `        SWITCHBOARD_FIXTURE_CALL_LOG: ${JSON.stringify(fixtureCallLogPath)}`,
      `        SUPABASE_LITERAL_ENV: literal_should_not_be_injected`
    ].join("\n")
  );
  const unmountedProfile = [
    `  supabase_${repoSlug}_unmounted:`,
    `    provider: supabase`,
    `    namespace: supabase_${repoSlug}_unmounted`,
    `    upstream:`,
    `      type: stdio`,
    `      command: fixture-unmounted`,
    `      env:`,
    `        UNMOUNTED_SUPABASE_TOKEN:`,
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
