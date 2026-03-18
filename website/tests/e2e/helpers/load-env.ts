import fs from "node:fs";
import path from "node:path";

type LoadEnvOptions = {
  cwd?: string;
  files?: string[];
  override?: boolean;
};

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex <= 0) return null;

  const key = trimmed.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let rawValue = trimmed.slice(separatorIndex + 1).trim();
  if (!rawValue) return { key, value: "" };

  const quote = rawValue[0];
  if ((quote === '"' || quote === "'") && rawValue.endsWith(quote)) {
    return { key, value: rawValue.slice(1, -1) };
  }

  const commentIndex = rawValue.indexOf(" #");
  if (commentIndex >= 0) {
    rawValue = rawValue.slice(0, commentIndex).trimEnd();
  }

  return { key, value: rawValue };
}

function loadEnvFile(filePath: string, override: boolean): void {
  if (!fs.existsSync(filePath)) return;

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (!override && process.env[parsed.key] !== undefined) continue;
    process.env[parsed.key] = parsed.value;
  }
}

export function loadEnvFiles(options: LoadEnvOptions = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const files = options.files ?? [".env.local", ".env"];
  const override = options.override ?? false;

  for (const name of files) {
    const filePath = path.isAbsolute(name) ? name : path.resolve(cwd, name);
    loadEnvFile(filePath, override);
  }
}

