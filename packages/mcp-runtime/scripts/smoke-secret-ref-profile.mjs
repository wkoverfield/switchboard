#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
  `switchboard-secret-ref-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`
);
const secretRef = "fixture/demo/token";
const secretValue = "fixture-secret-value-do-not-print";
const secretEnvName = "SWITCHBOARD_FIXTURE_SECRET";
const secretHash = sha256(secretValue);

if (!existsSync(cliEntryPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:secret-ref-profile`."
  );
}

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

try {
  const missingDoctor = runCli(["--cwd", tmpRoot, "secrets", "doctor", "--json"]);
  assert(missingDoctor.status === 1, "expected missing secret doctor to fail");
  assertNoSecretLeak(missingDoctor, "missing doctor");
  const missing = parseJson(missingDoctor.stdout);
  assert(missing.ok === false, "expected missing doctor JSON ok=false");
  assert(
    missing.missing?.some?.((item) => item.ref === secretRef),
    "expected missing secretRef in doctor output"
  );

  const setSecret = runCli(
    ["secrets", "set", secretRef, "--value-stdin", "--json"],
    secretValue
  );
  assert(setSecret.status === 0, `secrets set failed:\n${setSecret.stderr}`);
  assertNoSecretLeak(setSecret, "secrets set");

  const listSecret = runCli(["secrets", "list", "--json"]);
  assert(
    listSecret.status === 0,
    `secrets list failed:\n${redactSecret(listSecret.stderr)}`
  );
  assertNoSecretLeak(listSecret, "secrets list");
  const listed = parseJson(listSecret.stdout);
  assert(
    listed.refs?.some?.((entry) => entry.ref === secretRef),
    "expected indexed secretRef"
  );

  const readyDoctor = runCli(["--cwd", tmpRoot, "secrets", "doctor", "--json"]);
  assert(
    readyDoctor.status === 0,
    `ready doctor failed:\n${redactSecret(readyDoctor.stderr)}`
  );
  assertNoSecretLeak(readyDoctor, "ready doctor");
  const ready = parseJson(readyDoctor.stdout);
  assert(ready.ok === true, "expected ready doctor JSON ok=true");
  assert(ready.missing?.length === 0, "expected no missing secretRefs");

  const testProfile = runCli(["--cwd", tmpRoot, "test", "secret_fixture", "--json"]);
  assert(
    testProfile.status === 0,
    `profile test failed:\n${redactSecret(testProfile.stderr)}`
  );
  assertNoSecretLeak(testProfile, "profile test");

  const tools = runCli(["--cwd", tmpRoot, "tools", "--json"]);
  assert(tools.status === 0, `tools failed:\n${redactSecret(tools.stderr)}`);
  assertNoSecretLeak(tools, "tools");
  const toolSurface = parseJson(tools.stdout);
  assert(
    toolSurface.tools?.some?.((tool) => tool.name === "secret_fixture_secret_status"),
    "expected secret status tool in tool surface"
  );

  await assertServeSeesSecret();
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

function runCli(args, input) {
  return spawnSync(process.execPath, [cliEntryPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    env: smokeEnv()
  });
}

async function assertServeSeesSecret() {
  const client = new Client({
    name: "switchboard-secret-ref-smoke",
    version: "0.1.0"
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliEntryPath, "--cwd", tmpRoot, "serve"],
    cwd: repoRoot,
    env: smokeEnv(),
    stderr: "pipe"
  });

  let serveStderr = "";
  transport.stderr?.on("data", (chunk) => {
    serveStderr += chunk.toString();
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert(
      tools.tools.some((tool) => tool.name === "secret_fixture_secret_status"),
      "expected secret status tool in serve tool list"
    );
    const result = await client.callTool({
      name: "secret_fixture_secret_status",
      arguments: {}
    });
    assert(textContent(result) === "secret:match", "expected injected secret env");
    assert(
      !JSON.stringify(result).includes(secretValue),
      "serve call printed secret value"
    );
    assertNoSecretText(serveStderr, "serve stderr");
  } finally {
    await client.close();
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

function parseJson(value) {
  return JSON.parse(value);
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
