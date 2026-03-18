import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { loadEnvFiles } from "./tests/e2e/helpers/load-env";

loadEnvFiles({ cwd: __dirname, files: [".env.local", ".env"] });

const reportDir = path.resolve(__dirname, "../evidence-pack/01-functional/playwright-report");
const jsonReportPath = path.resolve(__dirname, "test-results/playwright-results.json");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: reportDir, open: "never" }],
    ["json", { outputFile: jsonReportPath }],
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  outputDir: "test-results/artifacts",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox-desktop",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "pixel5-mobile",
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "iphone13-mobile",
      use: { ...devices["iPhone 13"] },
    },
  ],
});
