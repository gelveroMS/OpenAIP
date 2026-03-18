import { expect, type Page } from "@playwright/test";
import { getE2EBaseUrl, getRoleCredentials, type RoleKey } from "./env";

const STAFF_SIDEBAR_TEST_ID: Record<Exclude<RoleKey, "citizen">, string> = {
  barangay: "barangay-sidebar",
  city: "city-sidebar",
  admin: "admin-sidebar",
};

async function fillControlledField(page: Page, testId: string, value: string): Promise<void> {
  const field = page.getByTestId(testId);
  await field.click();
  await field.fill(value);
  await expect(field).toHaveValue(value);
}

async function waitForStaffLoginSuccess(
  page: Page,
  role: Exclude<RoleKey, "citizen">
): Promise<void> {
  const deadline = Date.now() + 30_000;
  const sidebar = page.getByTestId(STAFF_SIDEBAR_TEST_ID[role]);
  const loginError = page.getByTestId("auth-login-error");

  while (Date.now() < deadline) {
    if (await sidebar.isVisible().catch(() => false)) {
      await expect(page).not.toHaveURL(new RegExp(`/${role}/sign-in(?:$|[/?#])`));
      return;
    }

    if (await loginError.isVisible().catch(() => false)) {
      const message = (await loginError.textContent())?.trim() ?? "Unknown authentication error.";
      throw new Error(`${role} login failed: ${message}`);
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`Timed out waiting for authenticated ${role} shell. Last URL: ${page.url()}`);
}

async function loginStaffRole(page: Page, role: Exclude<RoleKey, "citizen">): Promise<void> {
  const { email, password } = getRoleCredentials(role);
  const baseURL = getE2EBaseUrl();

  await page.goto(`${baseURL}/${role}/sign-in`, { waitUntil: "networkidle" });
  await fillControlledField(page, "auth-login-email", email);
  await fillControlledField(page, "auth-login-password", password);
  await page.getByTestId("auth-login-submit").click();
  await waitForStaffLoginSuccess(page, role);
}

async function loginCitizen(page: Page): Promise<void> {
  const { email, password } = getRoleCredentials("citizen");
  const baseURL = getE2EBaseUrl();

  await page.goto(`${baseURL}/?auth=login&authStep=email&next=/`, {
    waitUntil: "networkidle",
  });

  await fillControlledField(page, "citizen-auth-email-input", email);
  await fillControlledField(page, "citizen-auth-password-input", password);
  await page.getByTestId("citizen-auth-submit").click();

  const deadline = Date.now() + 30_000;
  const authError = page.getByTestId("citizen-auth-error");
  const accountTrigger = page.getByTestId("citizen-nav-account-trigger");

  while (Date.now() < deadline) {
    if (await accountTrigger.isVisible().catch(() => false)) return;

    if (await authError.isVisible().catch(() => false)) {
      const message = (await authError.textContent())?.trim() ?? "Unknown authentication error.";
      throw new Error(`citizen login failed: ${message}`);
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`Timed out waiting for authenticated citizen shell. Last URL: ${page.url()}`);
}

export async function loginAsRole(page: Page, role: RoleKey): Promise<void> {
  if (role === "citizen") {
    await loginCitizen(page);
    return;
  }
  await loginStaffRole(page, role);
}
