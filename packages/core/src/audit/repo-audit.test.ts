import { describe, expect, it } from "vitest";
import { createRepoAudit } from "./repo-audit.js";
import type { SwitchboardScanResult } from "../scan/scan.js";

describe("repo audit", () => {
  it("marks bypass-present repos as unsafe with cleanup guidance", () => {
    const audit = createRepoAudit(
      scanFixture({
        authorityStatus: "bypass-present",
        bypasses: 1
      })
    );

    expect(audit.schemaVersion).toBe("switchboard.repo-audit.v1");
    expect(audit.status).toBe("unsafe");
    expect(audit.findingSummary).toMatchObject({
      bypasses: 1,
      directClientServers: 0,
      high: 1
    });
    expect(audit.checks).toContainEqual(
      expect.objectContaining({
        id: "direct-mcp-bypasses",
        status: "fail",
        nextActions: ["switchboard import --write --cleanup-client"]
      })
    );
    expect(audit.nextActions).toContain(
      "switchboard import --write --cleanup-client"
    );
  });

  it("marks controlled repos with installed clients and mandates as ready", () => {
    const audit = createRepoAudit(
      scanFixture({
        authorityStatus: "controlled",
        installedClients: true,
        profiles: ["github_ci"],
        mandateSuggestion: true
      })
    );

    expect(audit.status).toBe("ready");
    expect(audit.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("warns on unknown MCP commands and configured surface bloat", () => {
    const audit = createRepoAudit(
      scanFixture({
        authorityStatus: "partial-control",
        installedClients: true,
        profiles: [
          "github_ci",
          "vercel_preview",
          "supabase_dev",
          "stripe_test",
          "sentry_read",
          "posthog_read",
          "linear_read",
          "notion_read",
          "figma_read",
          "docs_read",
          "ci_read",
          "preview_read"
        ],
        unknownCommandBypass: true,
        acceptedBypass: true
      })
    );

    expect(audit.status).toBe("needs-attention");
    expect(audit.checks).toContainEqual(
      expect.objectContaining({
        id: "unknown-mcp-commands",
        status: "warn",
        evidence: ["codex:custom custom-mcp"]
      })
    );
    expect(audit.checks).toContainEqual(
      expect.objectContaining({
        id: "configured-surface-bloat",
        status: "warn"
      })
    );
    expect(audit.findingSummary.switchboardProfiles).toBe(12);
  });
});

function scanFixture(options: {
  authorityStatus: SwitchboardScanResult["authorityStatus"]["status"];
  bypasses?: number;
  installedClients?: boolean;
  profiles?: string[];
  mandateSuggestion?: boolean;
  unknownCommandBypass?: boolean;
  acceptedBypass?: boolean;
}): SwitchboardScanResult {
  const bypasses = options.bypasses ?? 0;
  const profiles = options.profiles ?? [];
  return {
    schemaVersion: "switchboard.scan.v1",
    repo: {
      cwd: "/repo",
      gitRoot: "/repo",
      name: "repo",
      branch: "main",
      remote: {
        url: null,
        owner: null,
        repo: null,
        provider: null
      }
    },
    runtime: {
      kind: "local",
      devcontainerPresent: false,
      vercelProjectPresent: false
    },
    clients: [
      {
        client: "codex",
        targetPath: "/repo/.codex/config.toml",
        status: options.installedClients ? "installed" : "missing",
        message: options.installedClients
          ? "Codex routes through Switchboard"
          : "Codex project MCP config missing",
        otherServerNames: []
      },
      {
        client: "claude",
        targetPath: "/repo/.mcp.json",
        status: options.installedClients ? "installed" : "missing",
        message: options.installedClients
          ? "Claude routes through Switchboard"
          : "Claude project MCP config missing",
        otherServerNames: []
      }
    ],
    providers: [],
    switchboard: {
      configSources: [],
      profileNames: profiles,
      workspaceNames: []
    },
    riskFindings: [],
    bypassFindings:
      bypasses > 0
        ? [
            {
              id: "codex:github",
              client: "codex",
              targetPath: "/repo/.codex/config.toml",
              serverName: "github",
              provider: "github",
              command: "docker",
              args: ["run", "ghcr.io/github/github-mcp-server"],
              envKeys: [],
              suggestedProfileName: "github_repo_ci",
              severity: "high",
              status: "unaccepted",
              riskTags: ["direct-mcp-server"],
              reasons: ["Direct MCP route can bypass Switchboard."],
              nextActions: ["switchboard import --write --cleanup-client"],
              acceptedRiskGuidance:
                "Use --accept-direct codex:github if intentional."
            }
          ]
        : options.unknownCommandBypass
          ? [
              {
                id: "codex:custom",
                client: "codex",
                targetPath: "/repo/.codex/config.toml",
                serverName: "custom",
                provider: "unknown",
                command: "custom-mcp",
                args: [],
                envKeys: [],
                suggestedProfileName: "custom_repo",
                severity: "medium",
                status: options.acceptedBypass ? "accepted" : "unaccepted",
                riskTags: ["direct-mcp-server"],
                reasons: ["Direct MCP route can bypass Switchboard."],
                nextActions: ["switchboard import --dry-run"],
                acceptedRiskGuidance:
                  "Use --accept-direct codex:custom if intentional."
              }
            ]
        : [],
    authorityStatus: {
      status: options.authorityStatus,
      summary: "Authority status summary.",
      blockers: bypasses > 0 ? ["codex:github"] : [],
      findings: bypasses > 0 ? ["codex:github"] : [],
      recommendedAction:
        bypasses > 0
          ? {
              command: "switchboard",
              args: ["import", "--write", "--cleanup-client"]
            }
          : null
    },
    suggestions: options.mandateSuggestion
      ? [
          {
            kind: "mandate",
            command: "switchboard mandate create --from github-ci",
            reason:
              "Use a leased mandate before letting an agent call provider tools."
          }
        ]
      : [],
    warnings: [],
    recommendedNextAction: {
      primary:
        bypasses > 0
          ? {
              kind: "bypass-cleanup",
              command: "switchboard import --write --cleanup-client",
              reason: "Direct MCP routes can bypass Switchboard authority."
            }
          : null,
      alternatives: []
    },
    nextActions:
      bypasses > 0 ? ["switchboard import --write --cleanup-client"] : []
  };
}
