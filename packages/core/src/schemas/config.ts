import * as z from "zod";
import { validateSecretRef } from "../secrets/secret-refs.js";

export const environmentSchema = z.enum([
  "local",
  "development",
  "staging",
  "production",
  "test",
  "live",
  "personal",
  "client"
]);

export const operatingModeSchema = z.enum([
  "inspect",
  "guarded",
  "autopilot",
  "unrestricted"
]);

export const enforcementLevelSchema = z.enum([
  "provider",
  "switchboard",
  "advisory"
]);

export const secretRefEnvValueSchema = z.object({
  secretRef: z.string().min(1).refine((value) => validateSecretRef(value).ok, {
    message:
      "secretRef must use lowercase letters, numbers, '.', '_', '-', and '/'"
  })
});

export const upstreamEnvValueSchema = z.union([
  z.string(),
  secretRefEnvValueSchema
]);

export const upstreamEnvSchema = z.record(z.string(), upstreamEnvValueSchema);

export const stdioUpstreamSchema = z
  .object({
    type: z.literal("stdio"),
    command: z.string().min(1, "stdio upstream command is required"),
    args: z.array(z.string()).optional(),
    cwd: z.string().min(1).optional(),
    env: upstreamEnvSchema.optional()
  })
  .passthrough();

export const upstreamSchema = z
  .object({
    type: z.string().min(1),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    cwd: z.string().min(1).optional(),
    env: upstreamEnvSchema.optional(),
    url: z.string().url().optional()
  })
  .passthrough()
  .superRefine((upstream, context) => {
    if (upstream.type === "stdio" && !upstream.command) {
      context.addIssue({
        code: "custom",
        path: ["command"],
        message: "stdio upstream command is required"
      });
    }
  });

export const profileSchema = z
  .object({
    provider: z.string().min(1, "profile.provider is required"),
    account: z.string().optional(),
    org: z.string().optional(),
    project: z.string().optional(),
    environment: environmentSchema.optional(),
    namespace: z.string().min(1).optional(),
    readOnly: z.boolean().default(false),
    mode: operatingModeSchema.optional(),
    enforcement: enforcementLevelSchema.optional(),
    auth: z
      .object({
        ref: z.string().min(1),
        type: z.string().min(1).optional()
      })
      .passthrough()
      .optional(),
    upstream: upstreamSchema.optional()
  })
  .passthrough();

export const workspaceSchema = z
  .object({
    paths: z.array(z.string()).default([]),
    profiles: z.array(z.string()).default([]),
    defaultEnvironment: environmentSchema.optional()
  })
  .passthrough();

export const policySchema = z
  .object({
    defaultMode: operatingModeSchema.optional(),
    requireConfirmation: z.array(z.string()).default([]),
    hideTools: z.array(z.string()).default([])
  })
  .passthrough();

export const acceptedDirectRiskSchema = z
  .object({
    id: z.string().min(1),
    client: z.enum(["codex", "claude"]),
    serverName: z.string().min(1),
    reason: z.string().min(1).optional()
  })
  .passthrough();

export const acceptedRisksSchema = z
  .object({
    directMcp: z.array(acceptedDirectRiskSchema).default([])
  })
  .passthrough();

export const switchboardConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    defaults: z.record(z.string(), z.unknown()).default({}),
    profiles: z.record(z.string(), profileSchema).default({}),
    workspaces: z.record(z.string(), workspaceSchema).default({}),
    policies: z.record(z.string(), policySchema).default({}),
    acceptedRisks: acceptedRisksSchema.default({ directMcp: [] })
  })
  .passthrough()
  .superRefine((config, context) => {
    for (const [profileName, profile] of Object.entries(config.profiles)) {
      if (!canNormalizeNamespace(profileName)) {
        context.addIssue({
          code: "custom",
          path: ["profiles", profileName],
          message:
            "Profile names must contain at least one letter or number for namespace generation."
        });
      }

      if (profile.namespace && !canNormalizeNamespace(profile.namespace)) {
        context.addIssue({
          code: "custom",
          path: ["profiles", profileName, "namespace"],
          message:
            "Profile namespace must contain at least one letter or number."
        });
      }
    }
  });

export type SwitchboardConfig = z.infer<typeof switchboardConfigSchema>;
export type ProfileConfig = z.infer<typeof profileSchema>;
export type ProfileConfigInput = z.input<typeof profileSchema>;
export type UpstreamConfig = z.infer<typeof upstreamSchema>;
export type StdioUpstreamConfig = z.infer<typeof stdioUpstreamSchema>;
export type UpstreamEnvValue = z.infer<typeof upstreamEnvValueSchema>;
export type WorkspaceConfig = z.infer<typeof workspaceSchema>;
export type PolicyConfig = z.infer<typeof policySchema>;
export type AcceptedRisksConfig = z.infer<typeof acceptedRisksSchema>;

function canNormalizeNamespace(input: string): boolean {
  return (
    input
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_{2,}/g, "_").length > 0
  );
}
