export type PasswordPolicyLike = {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialCharacters: boolean;
};

export type PasswordPolicyRuleId =
  | "min_length"
  | "uppercase"
  | "lowercase"
  | "number"
  | "special_character";

export type PasswordPolicyRuleStatus = {
  id: PasswordPolicyRuleId;
  label: string;
  errorMessage: string;
  passed: boolean;
};

export function getPasswordPolicyRuleStatus(
  password: string,
  policy: PasswordPolicyLike
): PasswordPolicyRuleStatus[] {
  const rules: PasswordPolicyRuleStatus[] = [
    {
      id: "min_length",
      label: `At least ${policy.minLength} characters`,
      errorMessage: `Password must be at least ${policy.minLength} characters.`,
      passed: password.length >= policy.minLength,
    },
  ];

  if (policy.requireUppercase) {
    rules.push({
      id: "uppercase",
      label: "At least one uppercase letter",
      errorMessage: "Password must include at least one uppercase letter.",
      passed: /[A-Z]/.test(password),
    });
  }

  if (policy.requireLowercase) {
    rules.push({
      id: "lowercase",
      label: "At least one lowercase letter",
      errorMessage: "Password must include at least one lowercase letter.",
      passed: /[a-z]/.test(password),
    });
  }

  if (policy.requireNumbers) {
    rules.push({
      id: "number",
      label: "At least one number",
      errorMessage: "Password must include at least one number.",
      passed: /[0-9]/.test(password),
    });
  }

  if (policy.requireSpecialCharacters) {
    rules.push({
      id: "special_character",
      label: "At least one special character",
      errorMessage: "Password must include at least one special character.",
      passed: /[^A-Za-z0-9]/.test(password),
    });
  }

  return rules;
}

export function validatePasswordWithPolicy(
  password: string,
  policy: PasswordPolicyLike
): string[] {
  return getPasswordPolicyRuleStatus(password, policy)
    .filter((rule) => !rule.passed)
    .map((rule) => rule.errorMessage);
}
