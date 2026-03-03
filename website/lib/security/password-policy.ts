export type PasswordPolicyLike = {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialCharacters: boolean;
};

export function validatePasswordWithPolicy(
  password: string,
  policy: PasswordPolicyLike
): string[] {
  const errors: string[] = [];

  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters.`);
  }

  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("Password must include at least one uppercase letter.");
  }

  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("Password must include at least one lowercase letter.");
  }

  if (policy.requireNumbers && !/[0-9]/.test(password)) {
    errors.push("Password must include at least one number.");
  }

  if (policy.requireSpecialCharacters && !/[^A-Za-z0-9]/.test(password)) {
    errors.push("Password must include at least one special character.");
  }

  return errors;
}

