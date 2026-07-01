import { describe, expect, it } from "vitest";
import {
  checkAuthorityMapDraft,
  draftAuthorityMap,
  parseAuthorityMapDraft
} from "./authority-map.js";

describe("authority map drafts", () => {
  it("classifies tool names conservatively with denied taking precedence", () => {
    const draft = draftAuthorityMap({
      profileName: "stripe_stockr_test",
      namespace: "stripe_stockr_test",
      generatedAt: new Date("2026-06-30T00:00:00.000Z"),
      toolNames: [
        "stripe_stockr_test_list_customers",
        "stripe_stockr_test_get_payment_intent",
        "stripe_stockr_test_get_secret",
        "stripe_stockr_test_create_refund",
        "stripe_stockr_test_execute_sql",
        "stripe_stockr_test_deploy_prod",
        "stripe_stockr_test_drop_table",
        "stripe_stockr_test_sync"
      ]
    });

    expect(draft.schemaVersion).toBe("switchboard.authority-map-draft.v1");
    expect(draft.counts).toEqual({
      tools: 8,
      allowed: 2,
      approvalRequired: 2,
      denied: 3,
      review: 1
    });
    expect(draft.groups.allowed.map((tool) => tool.toolName)).toEqual([
      "stripe_stockr_test_get_payment_intent",
      "stripe_stockr_test_list_customers"
    ]);
    expect(draft.groups.approvalRequired.map((tool) => tool.toolName)).toEqual([
      "stripe_stockr_test_create_refund",
      "stripe_stockr_test_execute_sql"
    ]);
    expect(draft.groups.denied.map((tool) => tool.toolName)).toEqual([
      "stripe_stockr_test_deploy_prod",
      "stripe_stockr_test_drop_table",
      "stripe_stockr_test_get_secret"
    ]);
    expect(draft.groups.review.map((tool) => tool.toolName)).toEqual([
      "stripe_stockr_test_sync"
    ]);
    expect(draft.suggestedMandatePolicy.allowedTools).toEqual([
      "stripe_stockr_test_get_payment_intent",
      "stripe_stockr_test_list_customers"
    ]);
    expect(draft.suggestedMandatePolicy.deniedTools).toEqual([
      "stripe_stockr_test_deploy_prod",
      "stripe_stockr_test_drop_table",
      "stripe_stockr_test_get_secret",
      "stripe_stockr_test_sync"
    ]);
    expect(draft.suggestedMandatePolicy.approvalGates).toHaveLength(2);
    expect(draft.needsHumanReview).toBe(true);
  });

  it("checks maps for duplicate groups, namespace drift, and sensitive allowed tools", () => {
    const draft = draftAuthorityMap({
      profileName: "github_stockr",
      namespace: "github_stockr",
      toolNames: ["github_stockr_list_checks", "github_stockr_update_issue"]
    });
    draft.groups.allowed.push({
      toolName: "github_stockr_update_issue",
      reason: "bad manual edit",
      matchedHeuristic: "manual",
      confidence: 0.1
    });
    draft.groups.review.push({
      toolName: "other_namespace_list_checks",
      reason: "bad namespace",
      matchedHeuristic: "manual",
      confidence: 0.1
    });

    const check = checkAuthorityMapDraft(draft);

    expect(check.ok).toBe(false);
    expect(check.errors).toContain(
      'tool "github_stockr_update_issue" appears in multiple groups: allowed, approvalRequired'
    );
    expect(check.errors).toContain(
      'tool "other_namespace_list_checks" does not belong to namespace "github_stockr"'
    );
    expect(check.warnings).toContain(
      'allowed tool "github_stockr_update_issue" looks sensitive; move it to approvalRequired, denied, or review.'
    );
  });

  it("rejects edited suggested mandate policies that broaden authority", () => {
    const draft = draftAuthorityMap({
      profileName: "stripe_stockr_test",
      namespace: "stripe_stockr_test",
      toolNames: [
        "stripe_stockr_test_list_customers",
        "stripe_stockr_test_create_refund",
        "stripe_stockr_test_delete_customer"
      ]
    });
    draft.suggestedMandatePolicy.allowedTools = ["*"];
    draft.suggestedMandatePolicy.deniedTools = [];
    draft.suggestedMandatePolicy.approvalGates = [];

    const check = checkAuthorityMapDraft(draft);

    expect(check.ok).toBe(false);
    expect(check.errors).toContain(
      'suggestedMandatePolicy pattern "*" uses a wildcard; V0 authority maps must use exact discovered tools'
    );
    expect(check.errors).toContain(
      'suggestedMandatePolicy pattern "*" does not belong to namespace "stripe_stockr_test"'
    );
    expect(check.errors).toContain(
      "suggestedMandatePolicy.allowedTools does not match allowed group tools"
    );
    expect(check.errors).toContain(
      "suggestedMandatePolicy.deniedTools does not match denied + review group tools"
    );
    expect(check.errors).toContain(
      "suggestedMandatePolicy.approvalGates does not match approvalRequired group tools"
    );
  });

  it("parses YAML authority maps and recomputes counts", () => {
    const draft = parseAuthorityMapDraft(`
schemaVersion: switchboard.authority-map-draft.v1
profileName: github_stockr
namespace: github_stockr
generatedAt: 2026-06-30T00:00:00.000Z
source:
  kind: profile-tools
  toolCount: 1
groups:
  allowed:
    - toolName: github_stockr_list_checks
      reason: read-only
      matchedHeuristic: allow-read-keyword
      confidence: 0.72
  approvalRequired: []
  denied: []
  review: []
suggestedMandatePolicy:
  allowedTools:
    - github_stockr_list_checks
  deniedTools: []
  approvalGates: []
needsHumanReview: false
warnings: []
nextActions: []
`);

    expect(draft.counts).toEqual({
      tools: 1,
      allowed: 1,
      approvalRequired: 0,
      denied: 0,
      review: 0
    });
    expect(checkAuthorityMapDraft(draft).ok).toBe(true);
  });
});
