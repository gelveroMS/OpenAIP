import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex <= 0) return null;

  const key = trimmed.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = trimmed.slice(separatorIndex + 1).trim();
  if (!value) return { key, value: "" };

  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    return { key, value: value.slice(1, -1) };
  }

  const commentIndex = value.indexOf(" #");
  if (commentIndex >= 0) {
    value = value.slice(0, commentIndex).trimEnd();
  }

  return { key, value };
}

function loadEnvFile(filePath, { override = false } = {}) {
  if (!fs.existsSync(filePath)) return;

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (!override && process.env[parsed.key] !== undefined) continue;
    process.env[parsed.key] = parsed.value;
  }
}

function loadDefaultEnvFiles() {
  const cwd = process.cwd();
  loadEnvFile(path.resolve(cwd, ".env.local"));
  loadEnvFile(path.resolve(cwd, ".env"));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: options.shell ?? false,
      env: process.env,
    });

    child.on("close", (code) => {
      resolve(typeof code === "number" ? code : 1);
    });
  });
}

async function main() {
  loadDefaultEnvFiles();

  const passthroughArgs = process.argv.slice(2);
  const playwrightCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const playwrightExitCode = await runCommand(
    playwrightCommand,
    ["playwright", "test", ...passthroughArgs],
    { shell: false }
  );

  const matrixExitCode = await runCommand(
    process.execPath,
    ["scripts/e2e/write-playwright-matrix.mjs"],
    { shell: false }
  );
  if (matrixExitCode !== 0) {
    console.error(`Compatibility matrix generation failed with exit code ${matrixExitCode}.`);
  }

  process.exit(playwrightExitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
