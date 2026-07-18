import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createChildMandate,
  createMandate,
  listMandates,
  readAuditLogEntries,
  resolveActiveMandate,
  resolveAuditLogPath,
  resolveMandateStorePath,
  revokeMandateCascade
} from "@switchboard-mcp/core";
import { handleDaemonRequest } from "./daemon-runtime.js";
import { createProgram } from "./program.js";

const fixtureServerPath = fileURLToPath(
  new URL("../../../packages/mcp-runtime/fixtures/echo-server.mjs", import.meta.url)
);

// This suite is the sandboxed deterministic proxy for the spawn-attenuation
// ship gate. It NEVER touches the real ~/.claude and NEVER touches the
// keychain: XDG state/config are redirected into a temp dir, TS_KEYRING_BACKEND
// is null, and the fixture profile carries no secretRef. It drives the proven
// mechanism directly (mint child mandates, route real tool calls through the
// in-process daemon handler, render the fleet tree, cascade-revoke) instead of
// spawning a real headless `claude`. See docs/security/attenuation.md for the
// exact real-claude gap this proxy does not cover.

describe("spawn-time attenuation ship gate (sandboxed proxy)", () => {
  const previous = {
    state: process.env.XDG_STATE_HOME,
    config: process.env.XDG_CONFIG_HOME,
    keyring: process.env.TS_KEYRING_BACKEND,
    parent: process.env.SWITCHBOARD_PARENT_MANDATE
  };

  afterEach(() => {
    restore("XDG_STATE_HOME", previous.state);
    restore("XDG_CONFIG_HOME", previous.config);
    restore("TS_KEYRING_BACKEND", previous.keyring);
    restore("SWITCHBOARD_PARENT_MANDATE", previous.parent);
  });

  it("attenuates a multi-worker wave: per-child identity, zero disruption, scope + floor, nesting, fleet, cascade", async () => {
    const root = await makeWaveRepo();

    // The human-facing root pass: full tool set except whoami (out of scope).
    const rootPass = await createMandate({
      task: "root",
      repoPath: root,
      worktreePath: root,
      branch: "-",
      agentRole: "orchestrator",
      profiles: ["github_findu"],
      allowedTools: [
        "github_findu_echo",
        "github_findu_read_data",
        "github_findu_deploy_prod"
      ],
      lease: "2h"
    });

    // Two workers, each auto-attenuated to its own child pass under the root.
    const childA = await createChildMandate({
      parentId: "root",
      task: "worker-a",
      repoPath: root,
      worktreePath: root,
      branch: "-",
      agentRole: "worker",
      profiles: ["github_findu"],
      lease: "30m",
      delegatedBy: "root"
    });
    const childB = await createChildMandate({
      parentId: "root",
      task: "worker-b",
      repoPath: root,
      worktreePath: root,
      branch: "-",
      agentRole: "worker",
      profiles: ["github_findu"],
      lease: "30m",
      delegatedBy: "root"
    });

    // (i) Distinct identities: distinct ids AND distinct audit uids.
    expect(childA.id).not.toBe(childB.id);
    expect(new Set([rootPass.mandateUid, childA.mandateUid, childB.mandateUid]).size).toBe(3);
    // v1 default scope: each child carries the SAME tool set as the parent.
    expect(childA.allowedTools).toEqual(rootPass.allowedTools);

    // (ii) Zero disruption: a legitimate worker's needed tools all WORK.
    await expect(call(root, "github_findu_echo", childA.id, { message: "hi" }))
      .resolves.toMatchObject({ ok: true, type: "tool_result" });
    await expect(call(root, "github_findu_read_data", childA.id))
      .resolves.toMatchObject({ ok: true, type: "tool_result" });

    // (iii) Out-of-scope tool denied for a child.
    await expect(call(root, "github_findu_whoami", childA.id)).resolves.toMatchObject({
      ok: false,
      error: 'tool "github_findu_whoami" is not allowed by pass policy'
    });

    // (iv) Seatbelt floor denies a catastrophe for a child even though the
    // tool is inside the mandate's allowlist.
    const catastrophe = await call(root, "github_findu_deploy_prod", childB.id);
    expect(catastrophe.ok).toBe(false);
    expect(catastrophe.error).toContain("switchboard seatbelt");

    // (v) Parent keeps full open access.
    await expect(call(root, "github_findu_echo", "root", { message: "root" }))
      .resolves.toMatchObject({ ok: true, type: "tool_result" });

    // Nested spawn: a worker mints a grandchild that is a subset of the CHILD,
    // not the root. Route a call as the grandchild to prove it works.
    const grandchild = await createChildMandate({
      parentId: childA.id,
      task: "worker-a-sub",
      repoPath: root,
      worktreePath: root,
      branch: "-",
      agentRole: "worker",
      profiles: ["github_findu"],
      lease: "10m",
      delegatedBy: childA.id
    });
    expect(grandchild.parentMandateId).toBe(childA.id);
    expect(grandchild.delegationPath).toEqual(["root", childA.id, grandchild.id]);
    await expect(call(root, "github_findu_echo", grandchild.id, { message: "deep" }))
      .resolves.toMatchObject({ ok: true, type: "tool_result" });

    // Each actor left a distinct audit identity in the log.
    const entries = await readAuditLogEntries({ path: resolveAuditLogPath() });
    const uids = new Set(
      entries
        .filter((entry) => entry.action === "tool_call")
        .map((entry) => entry.mandateUid)
        .filter(Boolean)
    );
    expect(uids.size).toBeGreaterThanOrEqual(4); // root + A + B + grandchild

    // (vi) The fleet report renders the delegation tree.
    const output: string[] = [];
    const program = createProgram({
      homeDir: await mkdtemp(join(tmpdir(), "switchboard-fleet-home-")),
      writeOut: (message) => output.push(message)
    });
    await program.parseAsync(["--cwd", root, "fleet", "--json"], { from: "user" });
    const payload = JSON.parse(output[0] ?? "{}") as {
      report: {
        roots: Array<{
          mandateId: string;
          children: Array<{
            mandateId: string;
            children: Array<{ mandateId: string }>;
            calls: Array<{ toolName: string; denied: number }>;
          }>;
        }>;
        totals: { denied: number };
      };
    };
    const reportRoot = payload.report.roots.find((r) => r.mandateId === "root");
    expect(reportRoot).toBeDefined();
    const childIds = reportRoot?.children.map((c) => c.mandateId) ?? [];
    expect(childIds).toContain(childA.id);
    expect(childIds).toContain(childB.id);
    const reportChildA = reportRoot?.children.find((c) => c.mandateId === childA.id);
    expect(reportChildA?.children.map((c) => c.mandateId)).toContain(grandchild.id);
    expect(payload.report.totals.denied).toBeGreaterThanOrEqual(2);

    // Reversible: cascading revocation kills the whole subtree.
    const revoked = await revokeMandateCascade({ id: "root", repoPath: root });
    expect(revoked.revoked.map((m) => m.id).sort()).toEqual(
      [childA.id, childB.id, "root", grandchild.id].sort()
    );
    for (const id of ["root", childA.id, childB.id, grandchild.id]) {
      await expect(
        resolveActiveMandate({ id, repoPath: root })
      ).rejects.toThrow(/cancelled/);
    }
    // A routed call under a revoked child is now refused.
    await expect(call(root, "github_findu_echo", childA.id)).resolves.toMatchObject({
      ok: false
    });
  });
});

describe("mcp --mint-child verb", () => {
  const previousParent = process.env.SWITCHBOARD_PARENT_MANDATE;
  const previousKeyring = process.env.TS_KEYRING_BACKEND;

  afterEach(() => {
    restore("SWITCHBOARD_PARENT_MANDATE", previousParent);
    restore("TS_KEYRING_BACKEND", previousKeyring);
  });

  it("mints a distinct child under the parent and serves its scoped endpoint", async () => {
    process.env.TS_KEYRING_BACKEND = "null";
    const root = await makeWaveRepo();
    const mandateStorePath = resolveMandateStorePath();
    await createMandate({
      path: mandateStorePath,
      task: "root",
      repoPath: root,
      worktreePath: root,
      branch: "-",
      agentRole: "orchestrator",
      profiles: ["github_findu"],
      allowedTools: ["github_findu_echo"],
      lease: "2h"
    });

    const served: Array<string | undefined> = [];
    const program = createProgram({
      homeDir: await mkdtemp(join(tmpdir(), "switchboard-mint-home-")),
      mandateStorePath,
      writeOut: () => undefined,
      writeErr: () => undefined,
      daemonStatus: async () => runningDaemon(root),
      serveDaemonMcp: async (_socket, options) => {
        served.push(options?.mandateId);
      }
    });

    await program.parseAsync(
      ["--cwd", root, "mcp", "--mint-child", "--parent", "root"],
      { from: "user" }
    );

    const childId = served[0];
    expect(childId).toMatch(/^scoped-root-/);
    // The minted child is bound to the served endpoint and exported for nesting.
    expect(process.env.SWITCHBOARD_PARENT_MANDATE).toBe(childId);

    // A second spawn with no --parent nests under the child via the env the
    // first mint exported (grandchild subset of child, not root).
    await program.parseAsync(["--cwd", root, "mcp", "--mint-child"], {
      from: "user"
    });
    const grandId = served[1];
    expect(grandId).not.toBe(childId);

    const mandates = await listMandates({ path: mandateStorePath, repoPath: root });
    const grand = mandates.find((m) => m.id === grandId);
    expect(grand?.parentMandateId).toBe(childId);
    expect(grand?.delegationPath).toEqual(["root", childId, grandId]);
  });

  it("revokes a pass subtree in one command", async () => {
    const root = await makeWaveRepo();
    const mandateStorePath = resolveMandateStorePath();
    await createMandate({
      path: mandateStorePath,
      task: "root",
      repoPath: root,
      worktreePath: root,
      branch: "-",
      agentRole: "orchestrator",
      profiles: ["github_findu"],
      allowedTools: ["github_findu_echo"],
      lease: "2h"
    });
    const child = await createChildMandate({
      path: mandateStorePath,
      parentId: "root",
      task: "worker",
      repoPath: root,
      worktreePath: root,
      branch: "-",
      agentRole: "worker",
      profiles: ["github_findu"],
      lease: "30m"
    });

    const output: string[] = [];
    await createProgram({
      homeDir: await mkdtemp(join(tmpdir(), "switchboard-revoke-home-")),
      mandateStorePath,
      writeOut: (message) => output.push(message)
    }).parseAsync(["--cwd", root, "pass", "revoke", "root", "--json"], {
      from: "user"
    });

    const payload = JSON.parse(output[0] ?? "{}") as {
      revoked: Array<{ id: string }>;
    };
    expect(payload.revoked.map((m) => m.id).sort()).toEqual(
      ["root", child.id].sort()
    );
    await expect(
      resolveActiveMandate({ path: mandateStorePath, id: child.id, repoPath: root })
    ).rejects.toThrow(/cancelled/);
  });

  it("fails clearly when no parent can be resolved", async () => {
    const root = await makeWaveRepo();
    const errors: string[] = [];
    const program = createProgram({
      homeDir: await mkdtemp(join(tmpdir(), "switchboard-mint-home-")),
      mandateStorePath: resolveMandateStorePath(),
      writeErr: (message) => errors.push(message),
      daemonStatus: async () => runningDaemon(root),
      serveDaemonMcp: async () => undefined
    });

    await program.parseAsync(["--cwd", root, "mcp", "--mint-child"], {
      from: "user"
    });

    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain("no active root pass");
    process.exitCode = undefined;
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function runningDaemon(root: string): {
  state: "running";
  paths: { runtimeDir: string; socketPath: string; statePath: string };
  daemon: {
    version: 1;
    pid: number;
    startedAt: string;
    socketPath: string;
    cwd: string;
  };
} {
  const socketPath = join(root, "daemon.sock");
  return {
    state: "running",
    paths: {
      runtimeDir: root,
      socketPath,
      statePath: join(root, "daemon.json")
    },
    daemon: {
      version: 1,
      pid: process.pid,
      startedAt: "2026-07-18T16:00:00.000Z",
      socketPath,
      cwd: root
    }
  };
}

async function call(
  cwd: string,
  name: string,
  mandateId: string,
  args: Record<string, unknown> = {}
): Promise<{ ok: boolean; error?: string; type?: string }> {
  return handleDaemonRequest(
    JSON.stringify({
      id: `${name}-${mandateId}`,
      type: "call_tool",
      name,
      mandateId,
      arguments: args
    }),
    { cwd }
  ) as Promise<{ ok: boolean; error?: string; type?: string }>;
}

// A sandboxed repo whose one profile exposes echo, whoami, read_data, and a
// deploy_prod catastrophe tool through the offline echo fixture. XDG state and
// config are redirected here; no keychain, no secrets, no real ~/.claude.
async function makeWaveRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "switchboard-wave-"));
  process.env.XDG_STATE_HOME = join(root, "state");
  process.env.XDG_CONFIG_HOME = join(root, "config");
  process.env.TS_KEYRING_BACKEND = "null";
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(
    join(root, ".switchboard.yaml"),
    [
      "version: 1",
      "profiles:",
      "  github_findu:",
      "    provider: generic",
      "    namespace: github_findu",
      "    upstream:",
      "      type: stdio",
      `      command: ${JSON.stringify(process.execPath)}`,
      "      args:",
      `        - ${JSON.stringify(fixtureServerPath)}`,
      "        - github-findu",
      '        - ""',
      '        - ""',
      "        - read_data",
      "        - deploy_prod"
    ].join("\n")
  );
  return root;
}
