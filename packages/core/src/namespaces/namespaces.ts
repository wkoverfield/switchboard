import type { ProfileConfigInput } from "../schemas/config.js";

export interface NamespaceCollision {
  namespace: string;
  profiles: string[];
}

export interface ProfileNamespace {
  profile: string;
  namespace: string;
  generated: boolean;
}

export function slugifyNamespace(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

export function normalizeNamespace(input: string): string {
  const namespace = slugifyNamespace(input);
  if (namespace.length === 0) {
    throw new Error("Namespace must contain at least one letter or number.");
  }
  return namespace;
}

export function namespaceForProfile(
  profileName: string,
  profile: ProfileConfigInput
): ProfileNamespace {
  if (profile.namespace) {
    return {
      profile: profileName,
      namespace: normalizeNamespace(profile.namespace),
      generated: false
    };
  }

  return {
    profile: profileName,
    namespace: normalizeNamespace(profileName),
    generated: true
  };
}

export function namespacesForProfiles(
  profiles: Record<string, ProfileConfigInput>
): ProfileNamespace[] {
  return Object.entries(profiles).map(([profileName, profile]) =>
    namespaceForProfile(profileName, profile)
  );
}

export function detectNamespaceCollisions(
  profiles: Record<string, ProfileConfigInput>
): NamespaceCollision[] {
  const grouped = new Map<string, string[]>();

  for (const resolved of namespacesForProfiles(profiles)) {
    const profilesForNamespace = grouped.get(resolved.namespace) ?? [];
    profilesForNamespace.push(resolved.profile);
    grouped.set(resolved.namespace, profilesForNamespace);
  }

  return [...grouped.entries()]
    .filter(([, profileNames]) => profileNames.length > 1)
    .map(([namespace, profileNames]) => ({
      namespace,
      profiles: profileNames.sort()
    }))
    .sort((a, b) => a.namespace.localeCompare(b.namespace));
}
