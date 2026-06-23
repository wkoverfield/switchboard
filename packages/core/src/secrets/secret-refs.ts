export interface SecretRefValidation {
  ok: boolean;
  errors: string[];
}

const secretRefPattern = /^[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/;

export function isSecretRefValue(value: unknown): value is { secretRef: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "secretRef" in value &&
    typeof value.secretRef === "string"
  );
}

export function validateSecretRef(ref: string): SecretRefValidation {
  const errors: string[] = [];
  const trimmed = ref.trim();

  if (trimmed.length === 0) {
    errors.push("secretRef must not be empty");
  }

  if (trimmed !== ref) {
    errors.push("secretRef must not include leading or trailing whitespace");
  }

  if (!secretRefPattern.test(ref)) {
    errors.push(
      "secretRef must use lowercase letters, numbers, '.', '_', '-', and '/'"
    );
  }

  if (ref.includes("//")) {
    errors.push("secretRef must not contain empty path segments");
  }

  return { ok: errors.length === 0, errors };
}

export function assertValidSecretRef(ref: string): void {
  const validation = validateSecretRef(ref);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }
}
