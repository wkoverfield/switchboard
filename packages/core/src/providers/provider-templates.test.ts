import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { switchboardConfigSchema } from "../schemas/config.js";
import {
  checkProviderSafetyTemplateTools,
  getProviderSafetyTemplate,
  listProviderSafetyTemplates,
  providerSafetyTemplatePolicy,
  renderProviderSafetyTemplate
} from "./provider-templates.js";

describe("provider safety templates", () => {
  it("lists built-in provider templates without raw secret values", () => {
    expect(listProviderSafetyTemplates().map((template) => template.id)).toEqual([
      "github-ci",
      "vercel-preview"
    ]);
    expect(JSON.stringify(listProviderSafetyTemplates())).not.toContain("ghp_");
    expect(JSON.stringify(listProviderSafetyTemplates())).not.toContain(
      "vercel-token-value"
    );
  });

  it("renders schema-valid GitHub CI config with secretRef env", () => {
    const rendered = renderProviderSafetyTemplate("github-ci", {
      profileName: "github_findu",
      namespace: "GitHub FindU",
      secretRef: "github/findu/dev/token",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"]
    });
    const parsed = switchboardConfigSchema.parse(parseYaml(rendered.configYaml));

    expect(parsed.profiles.github_findu).toMatchObject({
      provider: "github",
      namespace: "github_findu",
      mode: "guarded",
      enforcement: "switchboard",
      upstream: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN: {
            secretRef: "github/findu/dev/token"
          }
        }
      }
    });
    expect(rendered.namespace).toBe("github_findu");
    expect(rendered.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);
    expect(rendered.secretCommands).toEqual([
      "switchboard secrets set github/findu/dev/token --value-stdin"
    ]);
    expect(rendered.mandateCommand).toContain("--allow-tool 'github_findu_*'");
    expect(rendered.mandateCommand).toContain(
      "--deny-tool github_findu_deploy_prod"
    );
    expect(rendered.mandateCommand).toContain("--require-approval-risk medium");
    expect(rendered.mandateCommand).toContain(
      "--require-approval-labels 'github,write'"
    );
    expect(rendered.mandateCommand).toContain(
      "--require-approval-labels 'github,copilot,write'"
    );
    expect(rendered.mandateCommand).not.toContain("--require-approval-label ");
    expect(rendered.credentialGuidance.minimumScopes).toContain(
      "read checks/statuses"
    );
    expect(rendered.credentialGuidance.approvalScopes).toContain(
      "rerun workflow jobs"
    );
    expect(rendered.credentialGuidance.avoidScopes).toContain("delete_repo");
    expect(rendered.configYaml).not.toContain("ghp_");
  });

  it("renders provider mandate commands for an override branch", () => {
    const rendered = renderProviderSafetyTemplate("github-ci", {
      mandateBranch: "main"
    });

    expect(rendered.mandateCommand).toContain("--branch main");
    expect(rendered.mandateCommand).not.toContain("--branch fix/ci");
  });

  it("renders Vercel preview policy with production actions denied", () => {
    const rendered = renderProviderSafetyTemplate("vercel-preview", {
      namespace: "vercel_findu_preview",
      secretRef: "vercel/findu/preview/token"
    });
    const parsed = switchboardConfigSchema.parse(parseYaml(rendered.configYaml));

    expect(parsed.profiles.vercel_preview).toMatchObject({
      provider: "vercel",
      environment: "staging",
      upstream: {
        env: {
          VERCEL_TOKEN: {
            secretRef: "vercel/findu/preview/token"
          }
        }
      }
    });
    expect(rendered.mandateCommand).toContain(
      "--deny-tool vercel_findu_preview_deploy_prod"
    );
    expect(rendered.mandateCommand).toContain(
      "--deny-tool 'vercel_findu_preview_*production*'"
    );
    expect(rendered.mandateCommand).toContain(
      "--deny-tool 'vercel_findu_preview_domain_*'"
    );
    expect(rendered.mandateCommand).toContain(
      "--deny-tool 'vercel_findu_preview_billing_*'"
    );
    expect(rendered.mandateCommand).toContain(
      "--deny-tool 'vercel_findu_preview_team_*'"
    );
    expect(rendered.mandateCommand).toContain(
      "--deny-tool 'vercel_findu_preview_env_*'"
    );
    expect(rendered.mandateCommand).toContain(
      "--deny-tool 'vercel_findu_preview_*secret*'"
    );
    expect(rendered.credentialGuidance.minimumScopes).toContain(
      "read deployments"
    );
    expect(rendered.credentialGuidance.avoidScopes).toContain(
      "production promotion"
    );
  });

  it("reports unknown templates", () => {
    expect(getProviderSafetyTemplate("missing")).toBeUndefined();
    expect(() => renderProviderSafetyTemplate("missing")).toThrow(
      'unknown provider safety template "missing"'
    );
  });

  it("renders reusable mandate policy for template checks", () => {
    expect(providerSafetyTemplatePolicy("github-ci", "GitHub FindU")).toMatchObject({
      allowedTools: ["github_findu_*"],
      deniedTools: [
        "github_findu_deploy_prod",
        "github_findu_delete*",
        "github_findu_delete_*",
        "github_findu_admin_*",
        "github_findu_create_repository"
      ],
      approvalGates: expect.arrayContaining([
        expect.objectContaining({
          toolPattern: "github_findu_create*",
          risk: "high"
        }),
        expect.objectContaining({
          toolPattern: "github_findu_*write*",
          risk: "medium"
        }),
        expect.objectContaining({
          toolPattern: "github_findu_*rerun*",
          risk: "medium"
        }),
        expect.objectContaining({
          toolPattern: "github_findu_*update*",
          risk: "medium"
        }),
        expect.objectContaining({
          toolPattern: "github_findu_*merge*",
          risk: "high"
        })
      ])
    });
  });

  it("checks observed provider tools against template policy", () => {
    const result = checkProviderSafetyTemplateTools("github-ci", {
      namespace: "github_findu",
      toolNames: [
        "github_findu_checks_list",
        "github_findu_checks_rerun",
        "github_findu_deploy_prod",
        "github_findu_delete_branch",
        "github_findu_secret_update",
        "github_findu_delete-repo",
        "github_findu_create.issue",
        "github_findu_updatePullRequest",
        "vercel_preview_logs"
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.counts).toMatchObject({
      tools: 9,
      allowed: 1,
      approvalRequired: 4,
      denied: 3,
      allowedSensitive: 0,
      notAllowed: 1
    });
    expect(result.counts.approvalRequired).toBe(4);
    expect(result.policyCovered).toBe(false);
    expect(result.requiresMandatePolicy).toBe(true);
    expect(result.tools).toMatchObject([
      { toolName: "github_findu_checks_list", classification: "allowed" },
      {
        toolName: "github_findu_checks_rerun",
        classification: "approval_required"
      },
      { toolName: "github_findu_deploy_prod", classification: "denied" },
      { toolName: "github_findu_delete_branch", classification: "denied" },
      {
        toolName: "github_findu_secret_update",
        classification: "approval_required"
      },
      {
        toolName: "github_findu_delete-repo",
        classification: "denied"
      },
      {
        toolName: "github_findu_create.issue",
        classification: "approval_required"
      },
      {
        toolName: "github_findu_updatePullRequest",
        classification: "approval_required"
      },
      { toolName: "vercel_preview_logs", classification: "not_allowed" }
    ]);
  });

  it("classifies Vercel preview production and admin-shaped tools safely", () => {
    const result = checkProviderSafetyTemplateTools("vercel-preview", {
      namespace: "vercel_preview",
      toolNames: [
        "vercel_preview_logs",
        "vercel_preview_deploy_preview",
        "vercel_preview_rollback_preview",
        "vercel_preview_deploy_prod",
        "vercel_preview_deploy_production",
        "vercel_preview_promote_production",
        "vercel_preview_env_list",
        "vercel_preview_create_env",
        "vercel_preview_environment_update",
        "vercel_preview_domains_list",
        "vercel_preview_domain_add",
        "vercel_preview_secret_status",
        "vercel_preview_token_create",
        "vercel_preview_billing_list",
        "vercel_preview_team_members"
      ]
    });

    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({
      tools: 15,
      allowed: 1,
      approvalRequired: 2,
      denied: 12,
      allowedSensitive: 0,
      notAllowed: 0
    });
    expect(result.tools).toMatchObject([
      { toolName: "vercel_preview_logs", classification: "allowed" },
      {
        toolName: "vercel_preview_deploy_preview",
        classification: "approval_required"
      },
      {
        toolName: "vercel_preview_rollback_preview",
        classification: "approval_required"
      },
      { toolName: "vercel_preview_deploy_prod", classification: "denied" },
      {
        toolName: "vercel_preview_deploy_production",
        classification: "denied"
      },
      {
        toolName: "vercel_preview_promote_production",
        classification: "denied"
      },
      { toolName: "vercel_preview_env_list", classification: "denied" },
      { toolName: "vercel_preview_create_env", classification: "denied" },
      {
        toolName: "vercel_preview_environment_update",
        classification: "denied"
      },
      { toolName: "vercel_preview_domains_list", classification: "denied" },
      { toolName: "vercel_preview_domain_add", classification: "denied" },
      { toolName: "vercel_preview_secret_status", classification: "denied" },
      { toolName: "vercel_preview_token_create", classification: "denied" },
      { toolName: "vercel_preview_billing_list", classification: "denied" },
      { toolName: "vercel_preview_team_members", classification: "denied" }
    ]);
  });
});
