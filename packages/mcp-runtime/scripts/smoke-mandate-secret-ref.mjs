#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const repoRoot = resolve(packageDir, "..", "..");
const fixtureServerPath = resolve(packageDir, "fixtures", "echo-server.mjs");
const cliEntryPath = resolve(repoRoot, "apps", "cli", "dist", "index.js");
const tmpRoot = join(
  tmpdir(),
  `switchboard-mandate-secret-ref-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`
);
const secretRef = "fixture/mandate/token";
const secretValue = "fixture-mandate-secret-value-do-not-print";
const secretEnvName = "SWITCHBOARD_MANDATE_FIXTURE_SECRET";
const secretHash = sha256(secretValue);
const mandateId = "fix-ci";
const toolName = "secret_fixture_secret_status";

if (!existsSync(cliEntryPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:mandate-secret-ref`."
  );
}

try {
  mkdirSync(tmpRoot, { recursive: true });
  writeFileSync(join(tmpRoot, ".gitignore"), ".switchboard.local.yaml\n");
  writeFileSync(
    join(tmpRoot, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  secret_fixture:",
      "    provider: generic",
      "    namespace: secret_fixture",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - secret",
      `        - ${secretEnvName}`,
      `        - ${secretHash}`,
      "      env:",
      `        ${secretEnvName}:`,
      `          secretRef: ${secretRef}`
    ].join("\n")
  );

  const setSecret = runCli(
    ["secrets", "set", secretRef, "--value-stdin", "--json"],
    secretValue
  );
  assert(
    setSecret.status === 0,
    `secrets set failed:\nstdout:\n${redactSecret(setSecret.stdout)}\nstderr:\n${redactSecret(setSecret.stderr)}`
  );
  assertNoSecretLeak(setSecret, "secrets set");

  const createMandate = runCliJson(
    "mandate",
    "create",
    mandateId,
    "--agent",
    "implementer",
    "--profiles",
    "secret_fixture",
    "--branch",
    "fix/ci",
    "--lease",
    "2h",
    "--allow-tool",
    "secret_fixture_*",
    "--json"
  );
  assert(createMandate.mandate?.id === mandateId, "expected created mandate");
  assertNoSecretText(JSON.stringify(createMandate), "mandate create JSON");

  const tools = runCliJson("tools", "--mandate", mandateId, "--json");
  assert(
    tools.tools?.some?.((tool) => tool.name === toolName),
    "expected secret fixture tool in mandate tool surface"
  );
  assertNoSecretText(JSON.stringify(tools), "tools JSON");

  await assertMandateServeSeesSecret();

  const logs = runCliJson("logs", "--mandate", mandateId, "--json");
  assert(
    logs.schemaVersion === "switchboard.audit-log.v1",
    "expected audit log schema"
  );
  assert(
    logs.entries?.some?.(
      (entry) =>
        entry.mandateId === mandateId &&
        entry.status === "ok" &&
        entry.toolName === toolName
    ),
    "expected mandate-linked successful secret fixture audit entry"
  );
  assertNoSecretText(JSON.stringify(logs), "audit logs JSON");
  assertNoSecretText(readAuditLog(), "raw audit JSONL");

  const report = runCliJson("mandate", "report", mandateId, "--json");
  assert(
    report.readiness?.missingSecretRefs?.length === 0,
    "expected no missing secret refs in mandate readiness"
  );
  assertNoSecretText(JSON.stringify(report), "mandate report JSON");
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

function runCli(args, input) {
  return spawnSync(process.execPath, [cliEntryPath, "--cwd", tmpRoot, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    env: smokeEnv()
  });
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

async function assertMandateServeSeesSecret() {
  const client = new Client({
    name: "switchboard-mandate-secret-ref-smoke",
    version: "0.1.0"
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliEntryPath, "--cwd", tmpRoot, "serve", "--mandate", mandateId],
    cwd: repoRoot,
    env: smokeEnv(),
    stderr: "pipe"
  });

  let serveStderr = "";
  transport.stderr?.on("data", (chunk) => {
    serveStderr += chunk.toString();
  });

  let callError;
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert(
      tools.tools.some((tool) => tool.name === toolName),
      "expected secret fixture tool in mandate serve tool list"
    );
    assertNoSecretText(JSON.stringify(tools), "mandate serve tools/list");

    const result = await client.callTool({
      name: toolName,
      arguments: {}
    });
    assert(textContent(result) === "secret:match", "expected injected secret env");
    assertNoSecretText(JSON.stringify(result), "mandate serve tool result");
  } catch (error) {
    callError = error;
  } finally {
    await client.close();
  }

  assertNoSecretText(serveStderr, "mandate serve stderr");
  if (callError) {
    throw callError;
  }
}

function smokeEnv() {
  return {
    ...process.env,
    XDG_CONFIG_HOME: join(tmpRoot, "xdg-config"),
    XDG_DATA_HOME: join(tmpRoot, "xdg-data"),
    XDG_STATE_HOME: join(tmpRoot, "xdg-state"),
    TS_KEYRING_BACKEND: "file",
    SWITCHBOARD_ALLOW_UNSAFE_SECRET_BACKENDS: "1"
  };
}

function readAuditLog() {
  return readFileSync(
    join(tmpRoot, "xdg-state", "switchboard", "logs", "switchboard.jsonl"),
    "utf8"
  );
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
    throw new Error(message);
  }
}

function textContent(result) {
  if (!Array.isArray(result.content)) {
    return "";
  }

  const first = result.content[0];
  if (first?.type !== "text" || typeof first.text !== "string") {
    return "";
  }

  return first.text;
}
