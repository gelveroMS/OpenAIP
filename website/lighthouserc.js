const REQUIRED_ROLE_CREDENTIAL_ENV = [
  "E2E_BARANGAY_EMAIL",
  "E2E_BARANGAY_PASSWORD",
  "E2E_CITY_EMAIL",
  "E2E_CITY_PASSWORD",
  "E2E_ADMIN_EMAIL",
  "E2E_ADMIN_PASSWORD",
];

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`[LHCI_CONFIG] Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function normalizeBaseUrl(rawUrl) {
  const url = new URL(rawUrl);
  return url.toString().replace(/\/+$/, "");
}

function buildUrl(baseUrl, pathname) {
  return new URL(pathname, `${baseUrl}/`).toString();
}

const baseUrl = normalizeBaseUrl(getRequiredEnv("LHCI_BASE_URL"));

for (const envName of REQUIRED_ROLE_CREDENTIAL_ENV) {
  getRequiredEnv(envName);
}

const urls = [
  buildUrl(baseUrl, "/"),
  buildUrl(baseUrl, "/barangay/aips"),
  buildUrl(baseUrl, "/city/aips"),
  buildUrl(baseUrl, "/admin/usage-controls"),
  buildUrl(baseUrl, "/aips"),
  buildUrl(baseUrl, "/budget-allocation"),
  buildUrl(baseUrl, "/projects"),
  buildUrl(baseUrl, "/ai-assistant"),
  buildUrl(baseUrl, "/about"),
];

module.exports = {
  ci: {
    collect: {
      url: urls,
      numberOfRuns: 3,
      puppeteerScript: "./scripts/lighthouse/puppeteer-auth.cjs",
      settings: {
        preset: "desktop",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.5 }],
        "largest-contentful-paint": ["warn", { maxNumericValue: 4000 }],
        "cumulative-layout-shift": ["warn", { maxNumericValue: 0.25 }],
        "total-blocking-time": ["warn", { maxNumericValue: 600 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "../evidence-pack/02-performance/lighthouse",
      reportFilenamePattern: "lhci-%%HOSTNAME%%-%%PATHNAME%%-%%DATETIME%%.%%EXTENSION%%",
    },
  },
};
