import { stringify as stringifyYaml } from "yaml";
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
  notes: string[];
}

export interface RenderProviderSafetyTemplateOptions {
  profileName?: string;
  namespace?: string;
  secretRef?: string;
  command?: string;
  args?: string[];
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
  notes: string[];
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
    secretEnvName: "GITHUB_TOKEN",
    defaultCommand: "github-mcp-server",
    defaultArgs: [],
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
        "{namespace}_delete_*",
        "{namespace}_admin_*"
      ],
      approvalGates: [
        {
          toolPattern: "{namespace}_*rerun*",
          reason: "rerunning CI changes remote provider state",
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
        "{namespace}_promote_*",
        "{namespace}_env_*",
        "{namespace}_domains_*"
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

  return {
    template,
    profileName,
    namespace,
    secretRef,
    command,
    args,
    configYaml: stringifyYaml(config, { lineWidth: 0 }),
    secretCommands: [`switchboard secrets set ${secretRef} --value-stdin`],
    mandateCommand: renderMandateCommand(template, profileName, namespace),
    notes: template.notes
  };
}

function renderMandateCommand(
  template: ProviderSafetyTemplate,
  profileName: string,
  namespace: string
): string {
  const parts = [
    "switchboard",
    "mandate",
    "create",
    template.recommendedMandate.task,
    "--agent",
    template.recommendedMandate.agent,
    "--profiles",
    profileName,
    "--branch",
    template.recommendedMandate.branch,
    "--lease",
    template.recommendedMandate.lease,
    ...template.recommendedMandate.allowedTools.flatMap((pattern) => [
      "--allow-tool",
      interpolateNamespace(pattern, namespace)
    ]),
    ...template.recommendedMandate.deniedTools.flatMap((pattern) => [
      "--deny-tool",
      interpolateNamespace(pattern, namespace)
    ]),
    ...template.recommendedMandate.approvalGates.flatMap((gate) => [
      "--require-approval-tool",
      interpolateNamespace(gate.toolPattern, namespace),
      "--require-approval-reason",
      gate.reason,
      "--require-approval-risk",
      gate.risk,
      ...gate.labels.flatMap((label) => ["--require-approval-label", label])
    ])
  ];

  return parts.map(shellQuoteIfNeeded).join(" ");
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
