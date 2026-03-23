import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
const require = createRequire(import.meta.url);

function loadWebsiteEnv() {
  const projectDir = process.cwd();
  try {
    loadEnvConfig(projectDir, false);
  } catch (error) {
    console.warn(
      `[LHCI_RUNNER] Unable to load .env files from ${projectDir}. Continuing with current process env.`,
    );
    console.warn(error instanceof Error ? error.message : String(error));
  }
}

function configureChromePath() {
  if (process.env.CHROME_PATH && process.env.CHROME_PATH.trim()) {
    return;
  }

  try {
    const playwright = require("playwright");
    const chromiumPath =
      typeof playwright?.chromium?.executablePath === "function"
        ? playwright.chromium.executablePath()
        : "";

    if (typeof chromiumPath === "string" && chromiumPath.trim() && fs.existsSync(chromiumPath)) {
      process.env.CHROME_PATH = chromiumPath;
      console.log(`[LHCI_RUNNER] Using Playwright Chromium via CHROME_PATH: ${chromiumPath}`);
      return;
    }
  } catch {
    // Fall through to warning below.
  }

  console.warn(
    "[LHCI_RUNNER] CHROME_PATH is not set and Playwright Chromium was not detected. Install Chrome or run `npm run e2e:install`.",
  );
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        stdio: "inherit",
        shell: false,
        env: process.env,
        cwd: process.cwd(),
      });
    } catch (error) {
      console.error(
        `[LHCI_RUNNER] Failed to spawn command: ${command} ${args.join(" ")}`,
      );
      console.error(error instanceof Error ? error.message : String(error));
      resolve(1);
      return;
    }

    child.on("error", (error) => {
      console.error(
        `[LHCI_RUNNER] Failed to run command: ${command} ${args.join(" ")}`,
      );
      console.error(error instanceof Error ? error.message : String(error));
      resolve(1);
    });

    child.on("close", (code) => {
      resolve(typeof code === "number" ? code : 1);
    });
  });
}

async function main() {
  loadWebsiteEnv();
  configureChromePath();

  const lhciCli = path.resolve(process.cwd(), "node_modules/@lhci/cli/src/cli.js");
  const lhciCommand = process.execPath;
  const lhciArgs = [lhciCli, "autorun", "--config=./lighthouserc.js"];
  const summaryScript = path.resolve(process.cwd(), "scripts/lighthouse/write-summary.mjs");

  const lhciExitCode = await runCommand(lhciCommand, lhciArgs);
  if (lhciExitCode !== 0) {
    console.error(`[LHCI_RUNNER] Lighthouse CI exited with code ${lhciExitCode}.`);
  }

  const summaryExitCode = await runCommand(process.execPath, [summaryScript]);
  if (summaryExitCode !== 0) {
    console.error(`[LHCI_RUNNER] Summary generation exited with code ${summaryExitCode}.`);
  }

  if (lhciExitCode !== 0) {
    process.exit(lhciExitCode);
  }
  if (summaryExitCode !== 0) {
    process.exit(summaryExitCode);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
