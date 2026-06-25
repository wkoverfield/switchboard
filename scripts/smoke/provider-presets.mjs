#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cliPath = resolve(repoRoot, "apps", "cli", "dist", "index.js");
const fixtureServerPath = resolve(
  repoRoot,
  "packages",
  "mcp-runtime",
  "fixtures",
  "echo-server.mjs"
);
const tmpRoot = join(
  tmpdir(),
  `switchboard-provider-presets-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`
);

if (!existsSync(cliPath)) {
  throw new Error(
    "Built CLI entrypoint not found. Run `pnpm build` before `pnpm smoke:provider-presets`."
  );
}

const list = run(["presets", "list", "--json"]);
assert(list.schemaVersion === "switchboard.provider-preset.v1", "list schema");
assert(
  list.templates?.some?.((template) => template.id === "github-ci"),
  "github-ci listed"
);
assert(
  list.templates?.some?.((template) => template.id === "vercel-preview"),
  "vercel-preview listed"
);

const github = run([
  "presets",
  "show",
  "github-ci",
  "--profile-name",
  "github_findu",
  "--namespace",
  "GitHub FindU",
  "--secret-ref",
  "github/findu/dev/token",
  "--command",
  "npx",
  "--arg",
  "-y",
  "--arg",
  "@modelcontextprotocol/server-github",
  "--json"
]);
assert(github.namespace === "github_findu", "normalized namespace");
assert(github.configYaml.includes("secretRef: github/findu/dev/token"), "secretRef");
assert(github.configYaml.includes("command: npx"), "command");
assert(github.configYaml.includes("- -y"), "arg");
assert(github.mandateCommand.includes("--allow-tool 'github_findu_*'"), "allow");
assert(
  github.mandatePolicy?.allowedTools?.includes?.("github_findu_*"),
  "rendered policy allow"
);
assert(
  github.mandateCommand.includes("--deny-tool github_findu_deploy_prod"),
  "deny prod"
);
assert(
  github.mandatePolicy?.deniedTools?.includes?.("github_findu_deploy_prod"),
  "rendered policy deny"
);
assert(
  github.credentialGuidance?.minimumScopes?.includes?.("read checks/statuses"),
  "github credential minimum scopes"
);
assert(
  github.credentialGuidance?.approvalScopes?.includes?.("rerun workflow jobs"),
  "github approval-gated credential scopes"
);
assert(
  github.credentialGuidance?.avoidScopes?.includes?.("delete_repo"),
  "github avoided credential scopes"
);
assertNoRawSecret(JSON.stringify(github), "github preset");

const vercel = run(["presets", "show", "vercel-preview", "--json"]);
assert(
  vercel.mandateCommand.includes("--deny-tool vercel_preview_deploy_prod"),
  "vercel prod denied"
);
assert(
  vercel.mandatePolicy?.deniedTools?.includes?.("vercel_preview_deploy_prod"),
  "vercel rendered policy deny"
);
assert(
  vercel.credentialGuidance?.minimumScopes?.includes?.("read deployments"),
  "vercel credential minimum scopes"
);
assert(
  vercel.credentialGuidance?.avoidScopes?.includes?.("production promotion"),
  "vercel avoided credential scopes"
);
assertNoRawSecret(JSON.stringify(vercel), "vercel preset");

try {
  mkdirSync(tmpRoot, { recursive: true });
  writeFileSync(join(tmpRoot, ".gitignore"), ".switchboard.local.yaml\n");
  writeFileSync(
    join(tmpRoot, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_ci:",
      "    provider: github",
      "    namespace: github_ci",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - github-ci"
    ].join("\n")
  );

  const check = run([
    "--cwd",
    tmpRoot,
    "presets",
    "check",
    "github-ci",
    "--profile",
    "github_ci",
    "--json"
  ]);
  assert(
    check.schemaVersion === "switchboard.provider-preset-check.v1",
    "check schema"
  );
  assert(check.ok === true, "fixture preset check ok");
  assert(check.counts?.allowed === 2, "fixture allowed tools");
  assertNoRawSecret(JSON.stringify(check), "provider check");
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

function assertNoRawSecret(value, label) {
  assert(!value.includes("ghp_"), `${label} contains GitHub token-like text`);
  assert(
    !value.includes("vercel-token-value"),
    `${label} contains Vercel token-like text`
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(
      `switchboard ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return JSON.parse(result.stdout);
}
