import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { switchboardConfigSchema } from "../schemas/config.js";
import {
  getProviderSafetyTemplate,
  listProviderSafetyTemplates,
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
          GITHUB_TOKEN: {
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
    expect(rendered.configYaml).not.toContain("ghp_");
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
      "--deny-tool 'vercel_findu_preview_env_*'"
    );
  });

  it("reports unknown templates", () => {
    expect(getProviderSafetyTemplate("missing")).toBeUndefined();
    expect(() => renderProviderSafetyTemplate("missing")).toThrow(
      'unknown provider safety template "missing"'
    );
  });
});
