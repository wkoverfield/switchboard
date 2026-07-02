import { describe, expect, it } from "vitest";
import { diffManifestClientRoutes } from "./route-diff.js";

describe("diffManifestClientRoutes", () => {
  it("reports in-sync clients with no findings", () => {
    const diff = diffManifestClientRoutes({
      clients: [
        {
          client: "codex",
          status: "installed",
          directServerNames: [],
          renderedAvailable: true
        },
        {
          client: "claude",
          status: "installed",
          directServerNames: [],
          renderedAvailable: true
        }
      ],
      acceptedDirectRisks: [],
      configValid: true
    });

    expect(diff.status).toBe("in-sync");
    expect(diff.counts).toEqual({
      clients: 2,
      inSync: 2,
      drift: 0,
      unknown: 0,
      findings: 0
    });
  });

  it("flags missing and stale Switchboard routes as drift", () => {
    const diff = diffManifestClientRoutes({
      clients: [
        {
          client: "codex",
          status: "missing",
          directServerNames: [],
          renderedAvailable: true
        },
        {
          client: "claude",
          status: "stale",
          directServerNames: [],
          renderedAvailable: true
        }
      ],
      acceptedDirectRisks: [],
      configValid: true
    });

    expect(diff.status).toBe("drift");
    expect(diff.counts.drift).toBe(2);
    expect(diff.clients[0]?.findings).toEqual([
      {
        type: "switchboard-route-missing",
        severity: "warning",
        client: "codex",
        message: expect.stringContaining("does not route through Switchboard"),
        resolveCommand: "switchboard install codex --write"
      }
    ]);
    expect(diff.clients[1]?.findings[0]?.type).toBe("switchboard-route-stale");
    expect(diff.clients[1]?.findings[0]?.resolveCommand).toBe(
      "switchboard install claude --write"
    );
  });

  it("separates direct routes from accepted direct routes", () => {
    const diff = diffManifestClientRoutes({
      clients: [
        {
          client: "codex",
          status: "installed",
          directServerNames: ["github", "sentry"],
          renderedAvailable: true
        }
      ],
      acceptedDirectRisks: [{ client: "codex", serverName: "sentry" }],
      configValid: true
    });

    const codex = diff.clients[0];
    expect(codex?.status).toBe("drift");
    expect(codex?.findings).toEqual([
      {
        type: "direct-route",
        severity: "warning",
        client: "codex",
        serverName: "github",
        message: expect.stringContaining("bypassing Switchboard authority"),
        resolveCommand:
          "switchboard import --write --cleanup-client --accept-direct codex:github"
      },
      {
        type: "accepted-direct-route",
        severity: "info",
        client: "codex",
        serverName: "sentry",
        message: expect.stringContaining("accepted risk"),
        resolveCommand: null
      }
    ]);
  });

  it("keeps accepted-only direct routes in sync", () => {
    const diff = diffManifestClientRoutes({
      clients: [
        {
          client: "claude",
          status: "installed",
          directServerNames: ["notion"],
          renderedAvailable: true
        }
      ],
      acceptedDirectRisks: [{ client: "claude", serverName: "notion" }],
      configValid: true
    });

    expect(diff.status).toBe("in-sync");
    expect(diff.clients[0]?.findings[0]?.severity).toBe("info");
  });

  it("marks unparseable client config as drift with an error finding", () => {
    const diff = diffManifestClientRoutes({
      clients: [
        {
          client: "codex",
          status: "invalid",
          directServerNames: [],
          renderedAvailable: true
        }
      ],
      acceptedDirectRisks: [],
      configValid: true
    });

    expect(diff.status).toBe("drift");
    expect(diff.clients[0]?.findings[0]).toMatchObject({
      type: "client-config-invalid",
      severity: "error",
      resolveCommand: "switchboard import --dry-run"
    });
  });

  it("reports unknown when the intended route cannot be rendered", () => {
    const invalidConfig = diffManifestClientRoutes({
      clients: [
        {
          client: "codex",
          status: "missing",
          directServerNames: ["github"],
          renderedAvailable: false
        }
      ],
      acceptedDirectRisks: [],
      configValid: false
    });

    expect(invalidConfig.clients[0]?.status).toBe("drift");
    expect(invalidConfig.clients[0]?.findings[0]).toMatchObject({
      type: "rendered-route-unavailable",
      severity: "error",
      resolveCommand: "switchboard doctor"
    });
    expect(
      invalidConfig.clients[0]?.findings.some(
        (finding) => finding.type === "direct-route"
      )
    ).toBe(true);
    expect(invalidConfig.status).toBe("drift");

    const renderFailed = diffManifestClientRoutes({
      clients: [
        {
          client: "claude",
          status: "installed",
          directServerNames: [],
          renderedAvailable: false
        }
      ],
      acceptedDirectRisks: [],
      configValid: true
    });
    expect(renderFailed.status).toBe("unknown");
    expect(renderFailed.clients[0]?.findings[0]?.severity).toBe("warning");
  });
});
