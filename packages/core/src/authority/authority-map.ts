import { parse as parseYaml } from "yaml";
import * as z from "zod";
import {
  mandateApprovalGateSchema,
  type MandateApprovalGate,
  type MandateToolPolicy
} from "../mandates/mandates.js";

export const authorityMapDraftSchemaVersion =
  "switchboard.authority-map-draft.v1" as const;

export type AuthorityMapGroup =
  | "allowed"
  | "approvalRequired"
  | "denied"
  | "review";

export interface AuthorityMapToolEntry {
  toolName: string;
  reason: string;
  matchedHeuristic: string;
  confidence: number;
}

export interface AuthorityMapDraft {
  schemaVersion: typeof authorityMapDraftSchemaVersion;
  profileName: string;
  namespace: string;
  generatedAt: string;
  source: {
    kind: "profile-tools";
    toolCount: number;
  };
  groups: Record<AuthorityMapGroup, AuthorityMapToolEntry[]>;
  counts: Record<AuthorityMapGroup, number> & { tools: number };
  suggestedMandatePolicy: MandateToolPolicy;
  needsHumanReview: boolean;
  warnings: string[];
  nextActions: string[];
}

export interface DraftAuthorityMapOptions {
  profileName: string;
  namespace: string;
  toolNames: string[];
  generatedAt?: Date;
}

export interface AuthorityMapCheckResult {
  ok: boolean;
  schemaVersion: "switchboard.authority-map-check.v1";
  mapSchemaVersion: typeof authorityMapDraftSchemaVersion;
  profileName: string;
  namespace: string;
  counts: AuthorityMapDraft["counts"];
  warnings: string[];
  errors: string[];
  needsHumanReview: boolean;
  nextActions: string[];
}

const authorityMapToolEntrySchema = z.object({
  toolName: z.string().min(1),
  reason: z.string().min(1),
  matchedHeuristic: z.string().min(1),
  confidence: z.number().min(0).max(1)
});

export const authorityMapDraftSchema = z.object({
  schemaVersion: z.literal(authorityMapDraftSchemaVersion),
  profileName: z.string().min(1),
  namespace: z.string().min(1),
  generatedAt: z.string().min(1),
  source: z.object({
    kind: z.literal("profile-tools"),
    toolCount: z.number().int().nonnegative()
  }),
  groups: z.object({
    allowed: z.array(authorityMapToolEntrySchema).default([]),
    approvalRequired: z.array(authorityMapToolEntrySchema).default([]),
    denied: z.array(authorityMapToolEntrySchema).default([]),
    review: z.array(authorityMapToolEntrySchema).default([])
  }),
  counts: z
    .object({
      tools: z.number().int().nonnegative(),
      allowed: z.number().int().nonnegative(),
      approvalRequired: z.number().int().nonnegative(),
      denied: z.number().int().nonnegative(),
      review: z.number().int().nonnegative()
    })
    .optional(),
  suggestedMandatePolicy: z.object({
    allowedTools: z.array(z.string()).optional(),
    deniedTools: z.array(z.string()).optional(),
    approvalGates: z.array(mandateApprovalGateSchema).optional()
  }),
  needsHumanReview: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).default([])
});

const deniedPattern =
  /(^|_)(prod|production|live|admin|root|service_role|service|secret|token|key|credential|billing|domain|delete|drop|truncate|destroy|remove|revoke|grant|payout|transfer|treasury|terminal|issuing)(_|$)/;
const approvalPattern =
  /(^|_)(create|update|write|execute|run|apply|deploy|rerun|comment|refund|migrate|migration|insert|upsert|set|cancel|rollback|merge|push|capture|confirm|approve|deny|promote|publish)(_|$)/;
const allowedPattern =
  /(^|_)(read|list|get|inspect|search|log|logs|status|show|fetch|query|select|describe|find|check|checks|whoami|echo)(_|$)/;

export function draftAuthorityMap(
  options: DraftAuthorityMapOptions
): AuthorityMapDraft {
  const groups: AuthorityMapDraft["groups"] = {
    allowed: [],
    approvalRequired: [],
    denied: [],
    review: []
  };

  for (const toolName of uniqueSorted(options.toolNames)) {
    const classification = classifyAuthorityMapTool(toolName);
    groups[classification.group].push({
      toolName,
      reason: classification.reason,
      matchedHeuristic: classification.matchedHeuristic,
      confidence: classification.confidence
    });
  }

  const counts = countAuthorityMapGroups(groups);
  const warnings = authorityMapWarnings(groups);
  const needsHumanReview = groups.review.length > 0 || warnings.length > 0;

  return {
    schemaVersion: authorityMapDraftSchemaVersion,
    profileName: options.profileName,
    namespace: options.namespace,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    source: {
      kind: "profile-tools",
      toolCount: counts.tools
    },
    groups,
    counts,
    suggestedMandatePolicy: suggestedMandatePolicy(groups),
    needsHumanReview,
    warnings,
    nextActions: [
      `Review denied and review tools before unattended agent use.`,
      `Run switchboard authority draft --profile ${options.profileName} --json for the machine-readable map.`,
      `Use the suggested mandate policy only after human review.`
    ]
  };
}

export function parseAuthorityMapDraft(content: string): AuthorityMapDraft {
  const parsedInput = parseYaml(content);
  const parsed = authorityMapDraftSchema.parse(parsedInput);
  const groups = {
    allowed: parsed.groups.allowed,
    approvalRequired: parsed.groups.approvalRequired,
    denied: parsed.groups.denied,
    review: parsed.groups.review
  };
  const counts = countAuthorityMapGroups(groups);
  return {
    schemaVersion: parsed.schemaVersion,
    profileName: parsed.profileName,
    namespace: parsed.namespace,
    generatedAt: parsed.generatedAt,
    source: parsed.source,
    groups,
    counts,
    suggestedMandatePolicy: parsed.suggestedMandatePolicy as MandateToolPolicy,
    needsHumanReview: parsed.needsHumanReview,
    warnings: parsed.warnings,
    nextActions: parsed.nextActions
  };
}

export function checkAuthorityMapDraft(
  draft: AuthorityMapDraft
): AuthorityMapCheckResult {
  const groups = draft.groups;
  const counts = countAuthorityMapGroups(groups);
  const warnings = [...draft.warnings];
  const errors: string[] = [];
  const seenGroups = new Map<string, AuthorityMapGroup[]>();

  for (const group of authorityMapGroupNames()) {
    for (const tool of groups[group]) {
      const toolGroups = seenGroups.get(tool.toolName) ?? [];
      toolGroups.push(group);
      seenGroups.set(tool.toolName, toolGroups);

      if (!tool.toolName.startsWith(`${draft.namespace}_`)) {
        errors.push(
          `tool "${tool.toolName}" does not belong to namespace "${draft.namespace}"`
        );
      }
    }
  }

  for (const [toolName, toolGroups] of seenGroups) {
    if (toolGroups.length > 1) {
      errors.push(
        `tool "${toolName}" appears in multiple groups: ${toolGroups.join(", ")}`
      );
    }
  }

  const expectedPolicy = suggestedMandatePolicy(groups);
  const policyErrors = compareSuggestedPolicy(
    draft.suggestedMandatePolicy,
    expectedPolicy,
    draft.namespace
  );
  errors.push(...policyErrors);

  if (groups.review.length > 0) {
    warnings.push(`${groups.review.length} tool(s) still need review.`);
  }

  for (const tool of groups.allowed) {
    if (classifyAuthorityMapTool(tool.toolName).group !== "allowed") {
      warnings.push(
        `allowed tool "${tool.toolName}" looks sensitive; move it to approvalRequired, denied, or review.`
      );
    }
  }

  const uniqueWarnings = uniqueStrings(warnings);
  return {
    ok: errors.length === 0,
    schemaVersion: "switchboard.authority-map-check.v1",
    mapSchemaVersion: draft.schemaVersion,
    profileName: draft.profileName,
    namespace: draft.namespace,
    counts,
    warnings: uniqueWarnings,
    errors,
    needsHumanReview: draft.needsHumanReview || uniqueWarnings.length > 0,
    nextActions: [
      ...(errors.length > 0
        ? ["Fix authority map errors before using the policy in a mandate."]
        : []),
      ...(uniqueWarnings.length > 0
        ? ["Review warnings before unattended agent use."]
        : []),
      ...(errors.length === 0
        ? ["Use suggestedMandatePolicy as the reviewed mandate policy input."]
        : [])
    ]
  };
}

function classifyAuthorityMapTool(toolName: string): {
  group: AuthorityMapGroup;
  reason: string;
  matchedHeuristic: string;
  confidence: number;
} {
  const normalized = normalizeToolName(toolName);
  if (deniedPattern.test(normalized)) {
    return {
      group: "denied",
      reason:
        "tool name looks production, admin, secret, token, destructive, billing, or privileged",
      matchedHeuristic: "deny-risk-keyword",
      confidence: 0.9
    };
  }
  if (approvalPattern.test(normalized)) {
    return {
      group: "approvalRequired",
      reason: "tool name looks write-like or state-changing",
      matchedHeuristic: "approval-write-keyword",
      confidence: 0.78
    };
  }
  if (allowedPattern.test(normalized)) {
    return {
      group: "allowed",
      reason: "tool name looks read-only or inspection-oriented",
      matchedHeuristic: "allow-read-keyword",
      confidence: 0.72
    };
  }
  return {
    group: "review",
    reason: "tool name does not match a deterministic V0 authority heuristic",
    matchedHeuristic: "unknown-review",
    confidence: 0.35
  };
}

function suggestedMandatePolicy(
  groups: AuthorityMapDraft["groups"]
): MandateToolPolicy {
  return {
    allowedTools: groups.allowed.map((tool) => tool.toolName),
    deniedTools: [
      ...groups.denied.map((tool) => tool.toolName),
      ...groups.review.map((tool) => tool.toolName)
    ],
    approvalGates: groups.approvalRequired.map(
      (tool, index): MandateApprovalGate => ({
        id: `authority-map-gate-${index + 1}`,
        toolPattern: tool.toolName,
        reason: tool.reason,
        risk: "medium",
        labels: ["authority-map", "agent-drafted"]
      })
    )
  };
}

function compareSuggestedPolicy(
  actual: MandateToolPolicy,
  expected: MandateToolPolicy,
  namespace: string
): string[] {
  const errors: string[] = [];
  const actualAllowed = uniqueSorted(actual.allowedTools ?? []);
  const actualDenied = uniqueSorted(actual.deniedTools ?? []);
  const expectedAllowed = uniqueSorted(expected.allowedTools ?? []);
  const expectedDenied = uniqueSorted(expected.deniedTools ?? []);

  for (const pattern of [...actualAllowed, ...actualDenied]) {
    if (pattern.includes("*")) {
      errors.push(
        `suggestedMandatePolicy pattern "${pattern}" uses a wildcard; V0 authority maps must use exact discovered tools`
      );
    }
    if (!pattern.startsWith(`${namespace}_`)) {
      errors.push(
        `suggestedMandatePolicy pattern "${pattern}" does not belong to namespace "${namespace}"`
      );
    }
  }

  if (!sameStringArray(actualAllowed, expectedAllowed)) {
    errors.push("suggestedMandatePolicy.allowedTools does not match allowed group tools");
  }
  if (!sameStringArray(actualDenied, expectedDenied)) {
    errors.push("suggestedMandatePolicy.deniedTools does not match denied + review group tools");
  }

  const actualGates = normalizeGateSummaries(actual.approvalGates ?? []);
  const expectedGates = normalizeGateSummaries(expected.approvalGates ?? []);
  if (!sameStringArray(actualGates, expectedGates)) {
    errors.push(
      "suggestedMandatePolicy.approvalGates does not match approvalRequired group tools"
    );
  }

  return uniqueStrings(errors);
}

function normalizeGateSummaries(gates: MandateApprovalGate[]): string[] {
  return gates
    .map((gate) =>
      [
        gate.toolPattern,
        gate.reason ?? "",
        gate.risk ?? "",
        gate.labels?.join(",") ?? ""
      ].join("|")
    )
    .sort();
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function authorityMapWarnings(groups: AuthorityMapDraft["groups"]): string[] {
  return [
    ...(groups.review.length > 0
      ? [`${groups.review.length} tool(s) could not be classified deterministically.`]
      : []),
    ...(groups.approvalRequired.length > 0
      ? [
          `${groups.approvalRequired.length} tool(s) change state and should stay approval-gated.`
        ]
      : [])
  ];
}

function countAuthorityMapGroups(
  groups: AuthorityMapDraft["groups"]
): AuthorityMapDraft["counts"] {
  return {
    tools:
      groups.allowed.length +
      groups.approvalRequired.length +
      groups.denied.length +
      groups.review.length,
    allowed: groups.allowed.length,
    approvalRequired: groups.approvalRequired.length,
    denied: groups.denied.length,
    review: groups.review.length
  };
}

function authorityMapGroupNames(): AuthorityMapGroup[] {
  return ["allowed", "approvalRequired", "denied", "review"];
}

function normalizeToolName(toolName: string): string {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
