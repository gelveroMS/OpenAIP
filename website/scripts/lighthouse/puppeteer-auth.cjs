const ROLE_CONFIG = {
  barangay: {
    emailEnv: "E2E_BARANGAY_EMAIL",
    passwordEnv: "E2E_BARANGAY_PASSWORD",
    signInPath: "/barangay/sign-in",
    expectedPrefix: "/barangay",
    shellTestId: "barangay-sidebar",
  },
  city: {
    emailEnv: "E2E_CITY_EMAIL",
    passwordEnv: "E2E_CITY_PASSWORD",
    signInPath: "/city/sign-in",
    expectedPrefix: "/city",
    shellTestId: "city-sidebar",
  },
  admin: {
    emailEnv: "E2E_ADMIN_EMAIL",
    passwordEnv: "E2E_ADMIN_PASSWORD",
    signInPath: "/admin/sign-in",
    expectedPrefix: "/admin",
    shellTestId: "admin-sidebar",
  },
};

const WAIT_TIMEOUT_MS = Number.parseInt(process.env.LHCI_AUTH_TIMEOUT_MS ?? "90000", 10);
const LOGIN_EMAIL_SELECTOR = '[data-testid="auth-login-email"]';
const LOGIN_PASSWORD_SELECTOR = '[data-testid="auth-login-password"]';
const LOGIN_SUBMIT_SELECTOR = '[data-testid="auth-login-submit"]';
const LOGIN_ERROR_SELECTOR = '[data-testid="auth-login-error"]';

let authenticatedRole = null;

function resolveRole(pathname) {
  if (pathname === "/barangay" || pathname.startsWith("/barangay/")) return "barangay";
  if (pathname === "/city" || pathname.startsWith("/city/")) return "city";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  return null;
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`[LHCI_AUTH] Missing required environment variable: ${name}`);
  }
  return value.trim();
}

async function clearBrowserCookies(browser) {
  const existingPages = await browser.pages();
  const page = existingPages[0] ?? (await browser.newPage());
  const client = await page.target().createCDPSession();
  await client.send("Network.enable");
  await client.send("Network.clearBrowserCookies");
  await client.send("Network.clearBrowserCache");
  await client.detach();
  if (!existingPages[0]) {
    await page.close();
  }
}

async function isVisible(page, selector) {
  try {
    return await page.$eval(selector, (element) => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      if (!style) return false;
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    });
  } catch {
    return false;
  }
}

async function getText(page, selector) {
  try {
    const text = await page.$eval(selector, (element) => element.textContent ?? "");
    return String(text).trim();
  } catch {
    return "";
  }
}

async function waitForAuthenticatedShell(page, role, roleConfig) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const currentPath = new URL(page.url()).pathname;
    const inRoleArea =
      currentPath.startsWith(roleConfig.expectedPrefix) && !currentPath.endsWith("/sign-in");

    if (inRoleArea && (await isVisible(page, `[data-testid="${roleConfig.shellTestId}"]`))) {
      return;
    }

    if (inRoleArea && !(await isVisible(page, LOGIN_EMAIL_SELECTOR))) {
      return;
    }

    if (await isVisible(page, LOGIN_ERROR_SELECTOR)) {
      const message = (await getText(page, LOGIN_ERROR_SELECTOR)) || "Unknown authentication error.";
      throw new Error(`[LHCI_AUTH] ${role} login failed: ${message}`);
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`[LHCI_AUTH] Timed out waiting for authenticated ${role} shell. Last URL: ${page.url()}`);
}

module.exports = async (browser, context) => {
  const targetUrl = new URL(context.url);
  const role = resolveRole(targetUrl.pathname);
  if (!role) {
    return;
  }

  if (authenticatedRole === role) {
    return;
  }

  const roleConfig = ROLE_CONFIG[role];
  const email = getRequiredEnv(roleConfig.emailEnv);
  const password = getRequiredEnv(roleConfig.passwordEnv);
  const signInUrl = new URL(roleConfig.signInPath, targetUrl.origin).toString();

  await clearBrowserCookies(browser);
  authenticatedRole = null;

  const page = await browser.newPage();
  page.setDefaultTimeout(WAIT_TIMEOUT_MS);

  try {
    await page.goto(signInUrl, { waitUntil: "networkidle" });
    await page.waitForSelector(LOGIN_EMAIL_SELECTOR);
    await page.waitForSelector(LOGIN_PASSWORD_SELECTOR);
    await page.waitForSelector(LOGIN_SUBMIT_SELECTOR);

    await page.click(LOGIN_EMAIL_SELECTOR, { clickCount: 3 });
    await page.type(LOGIN_EMAIL_SELECTOR, email);
    await page.click(LOGIN_PASSWORD_SELECTOR, { clickCount: 3 });
    await page.type(LOGIN_PASSWORD_SELECTOR, password);

    await page.waitForFunction(
      (submitSelector) => {
        const button = document.querySelector(submitSelector);
        return button instanceof HTMLButtonElement && !button.disabled;
      },
      { timeout: WAIT_TIMEOUT_MS },
      LOGIN_SUBMIT_SELECTOR
    );

    await page.click(LOGIN_SUBMIT_SELECTOR);
    await waitForAuthenticatedShell(page, role, roleConfig);
    authenticatedRole = role;
  } finally {
    await page.close();
  }
};
