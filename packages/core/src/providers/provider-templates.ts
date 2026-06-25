import { stringify as stringifyYaml } from "yaml";
import {
  evaluateMandateToolPolicy,
  type MandateApprovalGate,
  type MandateToolPolicy
} from "../mandates/mandates.js";
import { normalizeNamespace } from "../namespaces/namespaces.js";
import { switchboardConfigSchema } from "../schemas/config.js";

export interface ProviderSafetyTemplate {
  id: string;
  provider: string;
  label: string;
  description: string;
  defaultProfileName: string;
  defaultNamespace: string;
  defaultSecretRef: string;
  secretEnvName: string;
  defaultCommand: string;
  defaultArgs: string[];
  environment: string;
  readOnly: boolean;
  mode: "inspect" | "guarded" | "autopilot" | "unrestricted";
  recommendedMandate: {
    task: string;
    agent: string;
    branch: string;
    lease: string;
    allowedTools: string[];
    deniedTools: string[];
    approvalGates: Array<{
      toolPattern: string;
      reason: string;
      risk: "low" | "medium" | "high";
      labels: string[];
    }>;
  };
  credentialGuidance: {
    posture: string;
    minimumScopes: string[];
    approvalScopes: string[];
    avoidScopes: string[];
    notes: string[];
  };
  notes: string[];
}

export interface RenderProviderSafetyTemplateOptions {
  profileName?: string;
  namespace?: string;
  secretRef?: string;
  command?: string;
  args?: string[];
  mandateBranch?: string;
}

export interface RenderedProviderSafetyTemplate {
  template: ProviderSafetyTemplate;
  profileName: string;
  namespace: string;
  secretRef: string;
  command: string;
  args: string[];
  configYaml: string;
  secretCommands: string[];
  mandateCommand: string;
  mandateCommandArgs: string[];
  credentialGuidance: ProviderSafetyTemplate["credentialGuidance"];
  notes: string[];
}

export interface ProviderPresetToolCheck {
  toolName: string;
  classification:
    | "allowed"
    | "allowed_sensitive"
    | "approval_required"
    | "denied"
    | "not_allowed";
  reason: string;
  approvalGateId?: string;
  approvalGatePattern?: string;
}

export interface ProviderPresetCheckResult {
  template: ProviderSafetyTemplate;
  namespace: string;
  policy: MandateToolPolicy;
  ok: boolean;
  policyCovered: boolean;
  requiresMandatePolicy: boolean;
  counts: {
    tools: number;
    allowed: number;
    allowedSensitive: number;
    approvalRequired: number;
    denied: number;
    notAllowed: number;
  };
  tools: ProviderPresetToolCheck[];
  nextActions: string[];
}

export const providerSafetyTemplates: ProviderSafetyTemplate[] = [
  {
    id: "github-ci",
    provider: "github",
    label: "GitHub CI",
    description:
      "Generic GitHub MCP profile shape for inspecting checks and cautiously rerunning CI under a mandate.",
    defaultProfileName: "github_ci",
    defaultNamespace: "github_ci",
    defaultSecretRef: "github/example/dev/token",
    secretEnvName: "GITHUB_PERSONAL_ACCESS_TOKEN",
    defaultCommand: "docker",
    defaultArgs: [
      "run",
      "-i",
      "--rm",
      "-e",
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      "ghcr.io/github/github-mcp-server"
    ],
    environment: "development",
    readOnly: false,
    mode: "guarded",
    recommendedMandate: {
      task: "fix-ci",
      agent: "implementer",
      branch: "fix/ci",
      lease: "2h",
      allowedTools: ["{namespace}_*"],
      deniedTools: [
        "{namespace}_deploy_prod",
        "{namespace}_delete*",
        "{namespace}_delete_*",
        "{namespace}_admin_*",
        "{namespace}_create_repository"
      ],
      approvalGates: [
        {
          toolPattern: "{namespace}_*comment*",
          reason: "commenting changes GitHub conversation state",
          risk: "medium",
          labels: ["github", "write"]
        },
        {
          toolPattern: "{namespace}_add_reply*",
          reason: "replying changes GitHub conversation state",
          risk: "medium",
          labels: ["github", "write"]
        },
        {
          toolPattern: "{namespace}_assign_copilot*",
          reason: "assigning Copilot starts delegated remote work",
          risk: "high",
          labels: ["github", "copilot", "write"]
        },
        {
          toolPattern: "{namespace}_create*",
          reason: "creating GitHub resources changes repository or account state",
          risk: "high",
          labels: ["github", "write"]
        },
        {
          toolPattern: "{namespace}_fork_*",
          reason: "forking creates a repository under an account or organization",
          risk: "medium",
          labels: ["github", "write"]
        },
        {
          toolPattern: "{namespace}_*write*",
          reason: "write tools change GitHub repository, issue, or pull request state",
          risk: "medium",
          labels: ["github", "write"]
        },
        {
          toolPattern: "{namespace}_*rerun*",
          reason: "rerunning CI changes remote provider state",
          risk: "medium",
          labels: ["github", "write"]
        },
        {
          toolPattern: "{namespace}_push_*",
          reason: "pushing changes repository contents or refs",
          risk: "high",
          labels: ["github", "write"]
        },
        {
          toolPattern: "{namespace}_*update*",
          reason: "updating GitHub resources changes repository state",
          risk: "medium",
          labels: ["github", "write"]
        },
        {
          toolPattern: "{namespace}_*merge*",
          reason: "merging changes repository state and should stay human-gated",
          risk: "high",
          labels: ["github", "write"]
        }
      ]
    },
    credentialGuidance: {
      posture:
        "Start with a repo-scoped token that can read repository metadata, pull requests, checks, and workflow status. Add write scopes only when the team intends to approve CI reruns or GitHub write actions.",
      minimumScopes: [
        "read repository metadata",
        "read pull requests",
        "read checks/statuses",
        "read workflow runs/logs"
      ],
      approvalScopes: [
        "rerun workflow jobs",
        "write pull request comments or reviews",
        "push branches or update pull requests"
      ],
      avoidScopes: [
        "admin:org",
        "delete_repo",
        "repository creation",
        "production deployment credentials"
      ],
      notes: [
        "Use the narrowest GitHub token model available for the target repo or org.",
        "If a needed write action requires broader scopes, keep the matching tool approval-gated and record the reason in the mandate."
      ]
    },
    notes: [
      "Use a least-privilege token that can read repo metadata and checks; add write scopes only for the exact CI actions you intend to approve.",
      "Keep production deployment and admin tools outside the mandate allow list unless a human explicitly gates them."
    ]
  },
  {
    id: "vercel-preview",
    provider: "vercel",
    label: "Vercel Preview",
    description:
      "Generic Vercel MCP profile shape for preview deployment/log inspection with production actions denied.",
    defaultProfileName: "vercel_preview",
    defaultNamespace: "vercel_preview",
    defaultSecretRef: "vercel/example/preview/token",
    secretEnvName: "VERCEL_TOKEN",
    defaultCommand: "vercel-mcp-server",
    defaultArgs: [],
    environment: "staging",
    readOnly: false,
    mode: "guarded",
    recommendedMandate: {
      task: "inspect-preview",
      agent: "implementer",
      branch: "fix/preview",
      lease: "2h",
      allowedTools: ["{namespace}_*"],
      deniedTools: [
        "{namespace}_deploy_prod",
        "{namespace}_deploy_production",
        "{namespace}_*prod*",
        "{namespace}_*production*",
        "{namespace}_promote_*",
        "{namespace}_create_env",
        "{namespace}_*env*",
        "{namespace}_environment_*",
        "{namespace}_domain_*",
        "{namespace}_env_*",
        "{namespace}_domains_*",
        "{namespace}_*secret*",
        "{namespace}_*token*",
        "{namespace}_billing_*",
        "{namespace}_team_*"
      ],
      approvalGates: [
        {
          toolPattern: "{namespace}_*deploy*",
          reason: "deploying previews changes remote provider state",
          risk: "medium",
          labels: ["vercel", "write"]
        },
        {
          toolPattern: "{namespace}_*rollback*",
          reason: "rollback actions can affect shared environments",
          risk: "high",
          labels: ["vercel", "write"]
        }
      ]
    },
    credentialGuidance: {
      posture:
        "Use a token scoped to the Vercel team and project needed for preview inspection. Prefer read/log access first; add deploy or rollback capability only when those tools remain approval-gated.",
      minimumScopes: [
        "read project metadata",
        "read deployments",
        "read build/runtime logs"
      ],
      approvalScopes: [
        "create preview deployments",
        "rollback preview deployments"
      ],
      avoidScopes: [
        "production promotion",
        "environment variable writes",
        "domain management",
        "team or billing administration"
      ],
      notes: [
        "Keep production deploy, promote, env, and domain tools denied unless a specific mandate intentionally changes that posture.",
        "Use a separate token for preview dogfood instead of a broad personal production token."
      ]
    },
    notes: [
      "Prefer a token scoped to the project/team needed for the current repo.",
      "Production promotion, environment-variable edits, and domain changes should remain denied or approval-gated."
    ]
  }
];

export function listProviderSafetyTemplates(): ProviderSafetyTemplate[] {
  return providerSafetyTemplates;
}

export function getProviderSafetyTemplate(
  id: string
): ProviderSafetyTemplate | undefined {
  return providerSafetyTemplates.find((template) => template.id === id);
}

export function renderProviderSafetyTemplate(
  id: string,
  options: RenderProviderSafetyTemplateOptions = {}
): RenderedProviderSafetyTemplate {
  const template = getProviderSafetyTemplate(id);
  if (!template) {
    throw new Error(`unknown provider safety template "${id}"`);
  }

  const profileName = options.profileName ?? template.defaultProfileName;
  const namespace = normalizeNamespace(options.namespace ?? template.defaultNamespace);
  const secretRef = options.secretRef ?? template.defaultSecretRef;
  const command = options.command ?? template.defaultCommand;
  const args = options.args ?? template.defaultArgs;
  const config = {
    version: 1,
    profiles: {
      [profileName]: {
        provider: template.provider,
        environment: template.environment,
        namespace,
        readOnly: template.readOnly,
        mode: template.mode,
        enforcement: "switchboard",
        description: template.description,
        upstream: {
          type: "stdio",
          command,
          ...(args.length > 0 ? { args } : {}),
          env: {
            [template.secretEnvName]: {
              secretRef
            }
          }
        }
      }
    },
    workspaces: {
      default: {
        paths: ["."],
        profiles: [profileName],
        defaultEnvironment: template.environment
      }
    }
  };

  const parsed = switchboardConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join("\n"));
  }

  const mandateCommandArgs = renderMandateCommandArgs(
    template,
    profileName,
    namespace,
    options.mandateBranch ? { branch: options.mandateBranch } : {}
  );

  return {
    template,
    profileName,
    namespace,
    secretRef,
    command,
    args,
    configYaml: stringifyYaml(config, { lineWidth: 0 }),
    secretCommands: [`switchboard secrets set ${secretRef} --value-stdin`],
    mandateCommand: mandateCommandArgs.map(shellQuoteIfNeeded).join(" "),
    mandateCommandArgs,
    credentialGuidance: template.credentialGuidance,
    notes: template.notes
  };
}

export function providerSafetyTemplatePolicy(
  id: string,
  namespaceInput?: string
): MandateToolPolicy {
  const template = getProviderSafetyTemplate(id);
  if (!template) {
    throw new Error(`unknown provider safety template "${id}"`);
  }

  const namespace = normalizeNamespace(namespaceInput ?? template.defaultNamespace);
  return {
    allowedTools: template.recommendedMandate.allowedTools.map((pattern) =>
      interpolateNamespace(pattern, namespace)
    ),
    deniedTools: template.recommendedMandate.deniedTools.map((pattern) =>
      interpolateNamespace(pattern, namespace)
    ),
    approvalGates: template.recommendedMandate.approvalGates.map(
      (gate, index): MandateApprovalGate => ({
        id: `gate-${index + 1}`,
        toolPattern: interpolateNamespace(gate.toolPattern, namespace),
        reason: gate.reason,
        risk: gate.risk,
        labels: gate.labels
      })
    )
  };
}

export function checkProviderSafetyTemplateTools(
  id: string,
  options: { namespace?: string; toolNames: string[] }
): ProviderPresetCheckResult {
  const template = getProviderSafetyTemplate(id);
  if (!template) {
    throw new Error(`unknown provider safety template "${id}"`);
  }

  const namespace = normalizeNamespace(options.namespace ?? template.defaultNamespace);
  const policy = providerSafetyTemplatePolicy(id, namespace);
  const tools = options.toolNames.map((toolName) =>
    classifyProviderPresetTool(toolName, policy)
  );
  const counts = {
    tools: tools.length,
    allowed: tools.filter((tool) => tool.classification === "allowed").length,
    allowedSensitive: tools.filter(
      (tool) => tool.classification === "allowed_sensitive"
    ).length,
    approvalRequired: tools.filter(
      (tool) => tool.classification === "approval_required"
    ).length,
    denied: tools.filter((tool) => tool.classification === "denied").length,
    notAllowed: tools.filter((tool) => tool.classification === "not_allowed")
      .length
  };
  const policyCovered = counts.allowedSensitive === 0 && counts.notAllowed === 0;
  const requiresMandatePolicy =
    counts.approvalRequired > 0 || counts.denied > 0 || counts.allowedSensitive > 0;
  const nextActions = [
    ...(requiresMandatePolicy
      ? [
          "Use this profile through a mandate that applies the rendered allow, deny, and approval policy; direct unmandated profile use is not safety-checked."
        ]
      : []),
    ...(counts.allowedSensitive > 0
      ? [
          "Review allowed sensitive-looking tools and add deny or approval patterns before using this preset for unattended work."
        ]
      : []),
    ...(counts.notAllowed > 0
      ? [
          "Check that the rendered namespace matches the configured profile namespace."
        ]
      : [])
  ];

  return {
    template,
    namespace,
    policy,
    ok: policyCovered,
    policyCovered,
    requiresMandatePolicy,
    counts,
    tools,
    nextActions
  };
}

function renderMandateCommandArgs(
  template: ProviderSafetyTemplate,
  profileName: string,
  namespace: string,
  options: { branch?: string } = {}
): string[] {
  const policy = providerSafetyTemplatePolicy(template.id, namespace);
  const branch = options.branch ?? template.recommendedMandate.branch;
  return [
    "switchboard",
    "mandate",
    "create",
    template.recommendedMandate.task,
    "--agent",
    template.recommendedMandate.agent,
    "--profiles",
    profileName,
    "--branch",
    branch,
    "--lease",
    template.recommendedMandate.lease,
    ...(policy.allowedTools ?? []).flatMap((pattern) => [
      "--allow-tool",
      pattern
    ]),
    ...(policy.deniedTools ?? []).flatMap((pattern) => [
      "--deny-tool",
      pattern
    ]),
    ...(policy.approvalGates ?? []).flatMap((gate) => [
      "--require-approval-tool",
      gate.toolPattern,
      "--require-approval-reason",
      gate.reason ?? "",
      ...(gate.risk ? ["--require-approval-risk", gate.risk] : []),
      ...(gate.labels && gate.labels.length > 0
        ? ["--require-approval-labels", gate.labels.join(",")]
        : [])
    ])
  ];
}

function classifyProviderPresetTool(
  toolName: string,
  policy: MandateToolPolicy
): ProviderPresetToolCheck {
  const decision = evaluateMandateToolPolicy(toolName, policy);
  if (!decision.allowed && "approvalRequired" in decision) {
    return {
      toolName,
      classification: "approval_required",
      reason: decision.reason,
      approvalGateId: decision.approvalGate.id,
      approvalGatePattern: decision.approvalGate.toolPattern
    };
  }
  if (!decision.allowed && decision.reason.includes("is denied")) {
    return {
      toolName,
      classification: "denied",
      reason: decision.reason
    };
  }
  if (!decision.allowed) {
    return {
      toolName,
      classification: "not_allowed",
      reason: decision.reason
    };
  }
  if (isSensitiveLookingToolName(toolName)) {
    return {
      toolName,
      classification: "allowed_sensitive",
      reason:
        "tool name looks write-like or privileged but is currently allowed without explicit approval"
    };
  }

  return {
    toolName,
    classification: "allowed",
    reason: "tool is allowed by the preset policy"
  };
}

function isSensitiveLookingToolName(toolName: string): boolean {
  const normalized = toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
  return /(^|_)(admin|cancel|create|delete|deploy|destroy|domain|drop|env|merge|promote|remove|rerun|rollback|secret|set|token|update|write)(_|$)/.test(
    normalized
  );
}

function interpolateNamespace(value: string, namespace: string): string {
  return value.replaceAll("{namespace}", namespace);
}

function shellQuoteIfNeeded(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}
