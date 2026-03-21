import { expect, type Browser, type Page } from "@playwright/test";
import { getE2EBaseUrl, getStorageStatePath, type RoleKey } from "./env";
import { loginAsRole } from "./auth";

type LguRole = "barangay" | "city";

type GotoLguPathWithAuthOptions = {
  landingPath?: string;
};

const LGU_SIDEBAR_TEST_ID: Record<LguRole, string> = {
  barangay: "barangay-sidebar",
  city: "city-sidebar",
};

function signInPathPattern(role: LguRole): RegExp {
  return new RegExp(`/${role}/sign-in(?:$|[/?#])`);
}

async function assertLguAuthenticated(page: Page, role: LguRole): Promise<void> {
  await expect(page).not.toHaveURL(signInPathPattern(role), { timeout: 30_000 });
  await expect(page.getByTestId(LGU_SIDEBAR_TEST_ID[role])).toBeVisible({
    timeout: 30_000,
  });
}

export async function withRolePage<T>(
  browser: Browser,
  role: RoleKey,
  task: (page: Page) => Promise<T>
): Promise<T> {
  const context = await browser.newContext({
    baseURL: getE2EBaseUrl(),
    storageState: getStorageStatePath(role),
  });

  const page = await context.newPage();
  try {
    return await task(page);
  } finally {
    await context.close();
  }
}

export async function ensureClaimedReview(page: Page): Promise<void> {
  const claimButton = page.getByTestId("city-claim-review-button");
  if (await claimButton.isVisible().catch(() => false)) {
    await claimButton.click();
    await expect(claimButton).toBeHidden({ timeout: 20_000 });
  }
}

export async function ensureSelectValue(
  page: Page,
  triggerTestId: string,
  optionTestId: string
): Promise<void> {
  await page.getByTestId(triggerTestId).click();
  await page.getByTestId(optionTestId).click();
}

export async function gotoLguPathWithAuth(
  page: Page,
  role: LguRole,
  targetPath: string,
  options: GotoLguPathWithAuthOptions = {}
): Promise<void> {
  const landingPath = options.landingPath ?? targetPath;

  await page.goto(landingPath, { waitUntil: "domcontentloaded" });

  const redirectedToSignIn = signInPathPattern(role).test(page.url());
  if (redirectedToSignIn) {
    await loginAsRole(page, role);
  }

  if (landingPath !== targetPath || redirectedToSignIn) {
    await page.goto(targetPath, { waitUntil: "domcontentloaded" });
  }

  await assertLguAuthenticated(page, role);
}
