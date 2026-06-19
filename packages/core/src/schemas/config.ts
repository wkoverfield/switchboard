import * as z from "zod";

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
    upstream: z
      .object({
        type: z.string().min(1),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        url: z.string().url().optional()
      })
      .passthrough()
      .optional()
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

export const switchboardConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    defaults: z.record(z.string(), z.unknown()).default({}),
    profiles: z.record(z.string(), profileSchema).default({}),
    workspaces: z.record(z.string(), workspaceSchema).default({}),
    policies: z.record(z.string(), policySchema).default({})
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
export type WorkspaceConfig = z.infer<typeof workspaceSchema>;
export type PolicyConfig = z.infer<typeof policySchema>;

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
