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
      "stripe-test",
      "vercel-preview",
      "supabase-dev"
    ]);
    expect(JSON.stringify(listProviderSafetyTemplates())).not.toContain("ghp_");
    expect(JSON.stringify(listProviderSafetyTemplates())).not.toContain(
      "vercel-token-value"
    );
    expect(JSON.stringify(listProviderSafetyTemplates())).not.toContain(
      "sk_live_secret"
    );
    expect(JSON.stringify(listProviderSafetyTemplates())).not.toContain(
      "supabase-secret-value"
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
        command: "npx",
        args: ["-y", "vercel-platform-mcp-server"],
        env: {
          VERCEL_ENABLED_TOOLGROUPS: "readonly",
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

  it("renders Stripe test policy with test-mode credential guidance", () => {
    const rendered = renderProviderSafetyTemplate("stripe-test", {
      namespace: "stripe_findu_test",
      secretRef: "stripe/findu/test/secret-key"
    });
    const parsed = switchboardConfigSchema.parse(parseYaml(rendered.configYaml));

    expect(parsed.profiles.stripe_test).toMatchObject({
      provider: "stripe",
      environment: "test",
      mode: "guarded",
      upstream: {
        command: "sh",
        args: [
          "-c",
          'exec npx -y @stripe/mcp --api-key="$STRIPE_API_KEY"'
        ],
        env: {
          STRIPE_API_KEY: {
            secretRef: "stripe/findu/test/secret-key"
          }
        }
      }
    });
    expect(rendered.mandateCommand).toContain(
      "--deny-tool 'stripe_findu_test_*live*'"
    );
    expect(rendered.mandateCommand).toContain(
      "--deny-tool 'stripe_findu_test_payout*'"
    );
    expect(rendered.mandateCommand).toContain(
      "--require-approval-labels 'stripe,test,money'"
    );
    expect(rendered.credentialGuidance.posture).toContain("test-mode");
    expect(rendered.credentialGuidance.avoidScopes).toContain(
      "live-mode secret keys"
    );
    expect(rendered.notes.join(" ")).toContain("real money");
    expect(rendered.configYaml).not.toContain("sk_live");
  });

  it("renders Supabase dev policy with read-only default guidance", () => {
    const rendered = renderProviderSafetyTemplate("supabase-dev", {
      namespace: "supabase_findu_dev",
      secretRef: "supabase/findu/dev/access-token"
    });
    const parsed = switchboardConfigSchema.parse(parseYaml(rendered.configYaml));

    expect(parsed.profiles.supabase_dev).toMatchObject({
      provider: "supabase",
      environment: "development",
      readOnly: true,
      mode: "guarded",
      upstream: {
        command: "npx",
        args: [
          "-y",
          "@supabase/mcp-server-supabase@latest",
          "--read-only"
        ],
        env: {
          SUPABASE_ACCESS_TOKEN: {
            secretRef: "supabase/findu/dev/access-token"
          }
        }
      }
    });
    expect(rendered.mandateCommand).toContain(
      "--deny-tool 'supabase_findu_dev_*prod*'"
    );
    expect(rendered.mandateCommand).toContain(
      "--deny-tool 'supabase_findu_dev_*service_role*'"
    );
    expect(rendered.mandateCommand).toContain(
      "--deny-tool 'supabase_findu_dev_drop*'"
    );
    expect(rendered.mandateCommand).toContain(
      "--require-approval-tool supabase_findu_dev_execute_sql"
    );
    expect(rendered.mandateCommand).toContain(
      "--require-approval-labels 'supabase,database,schema'"
    );
    expect(rendered.credentialGuidance.minimumScopes).toContain(
      "read development schemas and tables"
    );
    expect(rendered.credentialGuidance.avoidScopes).toContain(
      "service_role keys"
    );
    expect(rendered.notes.join(" ")).toContain("development Supabase projects");
  });

  it("classifies Stripe test live and payment-affecting tools safely", () => {
    const result = checkProviderSafetyTemplateTools("stripe-test", {
      namespace: "stripe_test",
      toolNames: [
        "stripe_test_list_customers",
        "stripe_test_get_payment_intent",
        "stripe_test_search_charges",
        "stripe_test_create_customer",
        "stripe_test_update_subscription",
        "stripe_test_refund_charge",
        "stripe_test_cancel_subscription",
        "stripe_test_capture_payment_intent",
        "stripe_test_confirm_payment_intent",
        "stripe_test_live_charges",
        "stripe_test_production_balance",
        "stripe_test_payout_create",
        "stripe_test_transfer_create",
        "stripe_test_account_update",
        "stripe_test_webhook_secret_create",
        "stripe_test_token_create",
        "github_findu_checks_list"
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.counts).toMatchObject({
      tools: 17,
      allowed: 3,
      approvalRequired: 6,
      denied: 7,
      allowedSensitive: 0,
      notAllowed: 1
    });
    expect(result.tools).toMatchObject([
      { toolName: "stripe_test_list_customers", classification: "allowed" },
      { toolName: "stripe_test_get_payment_intent", classification: "allowed" },
      { toolName: "stripe_test_search_charges", classification: "allowed" },
      {
        toolName: "stripe_test_create_customer",
        classification: "approval_required"
      },
      {
        toolName: "stripe_test_update_subscription",
        classification: "approval_required"
      },
      {
        toolName: "stripe_test_refund_charge",
        classification: "approval_required"
      },
      {
        toolName: "stripe_test_cancel_subscription",
        classification: "approval_required"
      },
      {
        toolName: "stripe_test_capture_payment_intent",
        classification: "approval_required"
      },
      {
        toolName: "stripe_test_confirm_payment_intent",
        classification: "approval_required"
      },
      { toolName: "stripe_test_live_charges", classification: "denied" },
      { toolName: "stripe_test_production_balance", classification: "denied" },
      { toolName: "stripe_test_payout_create", classification: "denied" },
      { toolName: "stripe_test_transfer_create", classification: "denied" },
      { toolName: "stripe_test_account_update", classification: "denied" },
      { toolName: "stripe_test_webhook_secret_create", classification: "denied" },
      { toolName: "stripe_test_token_create", classification: "denied" },
      { toolName: "github_findu_checks_list", classification: "not_allowed" }
    ]);
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
        "vercel_preview_list_deployments",
        "vercel_preview_get_deployment",
        "vercel_preview_get_deployment_events",
        "vercel_preview_get_runtime_logs",
        "vercel_preview_create_deployment",
        "vercel_preview_cancel_deployment",
        "vercel_preview_delete_deployment",
        "vercel_preview_rollback_deployment",
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
      tools: 20,
      allowed: 4,
      approvalRequired: 4,
      denied: 12,
      allowedSensitive: 0,
      notAllowed: 0
    });
    expect(result.tools).toMatchObject([
      { toolName: "vercel_preview_list_deployments", classification: "allowed" },
      { toolName: "vercel_preview_get_deployment", classification: "allowed" },
      {
        toolName: "vercel_preview_get_deployment_events",
        classification: "allowed"
      },
      { toolName: "vercel_preview_get_runtime_logs", classification: "allowed" },
      {
        toolName: "vercel_preview_create_deployment",
        classification: "approval_required"
      },
      {
        toolName: "vercel_preview_cancel_deployment",
        classification: "approval_required"
      },
      {
        toolName: "vercel_preview_delete_deployment",
        classification: "approval_required"
      },
      {
        toolName: "vercel_preview_rollback_deployment",
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

  it("classifies Supabase dev database-shaped tools safely", () => {
    const result = checkProviderSafetyTemplateTools("supabase-dev", {
      namespace: "supabase_dev",
      toolNames: [
        "supabase_dev_list_tables",
        "supabase_dev_get_schema",
        "supabase_dev_select_rows",
        "supabase_dev_get_logs",
        "supabase_dev_execute_sql",
        "supabase_dev_apply_migration",
        "supabase_dev_create_table",
        "supabase_dev_insert_rows",
        "supabase_dev_update_rows",
        "supabase_dev_upsert_rows",
        "supabase_dev_set_config",
        "supabase_dev_delete_rows",
        "supabase_dev_drop_table",
        "supabase_dev_truncate_table",
        "supabase_dev_production_query",
        "supabase_dev_service_role_status",
        "supabase_dev_admin_update",
        "supabase_dev_token_create",
        "github_findu_checks_list"
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.counts).toMatchObject({
      tools: 19,
      allowed: 4,
      approvalRequired: 7,
      denied: 7,
      allowedSensitive: 0,
      notAllowed: 1
    });
    expect(result.tools).toMatchObject([
      { toolName: "supabase_dev_list_tables", classification: "allowed" },
      { toolName: "supabase_dev_get_schema", classification: "allowed" },
      { toolName: "supabase_dev_select_rows", classification: "allowed" },
      { toolName: "supabase_dev_get_logs", classification: "allowed" },
      {
        toolName: "supabase_dev_execute_sql",
        classification: "approval_required"
      },
      {
        toolName: "supabase_dev_apply_migration",
        classification: "approval_required"
      },
      {
        toolName: "supabase_dev_create_table",
        classification: "approval_required"
      },
      {
        toolName: "supabase_dev_insert_rows",
        classification: "approval_required"
      },
      {
        toolName: "supabase_dev_update_rows",
        classification: "approval_required"
      },
      {
        toolName: "supabase_dev_upsert_rows",
        classification: "approval_required"
      },
      {
        toolName: "supabase_dev_set_config",
        classification: "approval_required"
      },
      { toolName: "supabase_dev_delete_rows", classification: "denied" },
      { toolName: "supabase_dev_drop_table", classification: "denied" },
      { toolName: "supabase_dev_truncate_table", classification: "denied" },
      { toolName: "supabase_dev_production_query", classification: "denied" },
      { toolName: "supabase_dev_service_role_status", classification: "denied" },
      { toolName: "supabase_dev_admin_update", classification: "denied" },
      { toolName: "supabase_dev_token_create", classification: "denied" },
      { toolName: "github_findu_checks_list", classification: "not_allowed" }
    ]);
  });
});
