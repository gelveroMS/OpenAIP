import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = path.resolve(process.cwd(), "../evidence-pack/02-performance/lighthouse");
const SUMMARY_PATH = path.join(OUTPUT_DIR, "summary.md");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");

function isObject(value) {
  return value !== null && typeof value === "object";
}

function isLighthouseReport(value) {
  return (
    isObject(value) &&
    isObject(value.audits) &&
    isObject(value.categories)
  );
}

function toAbsolutePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(OUTPUT_DIR, filePath);
}

function formatScore(score) {
  if (typeof score !== "number") return "N/A";
  return `${Math.round(score * 100)}/100 (${score.toFixed(2)})`;
}

function formatMs(value) {
  if (typeof value !== "number") return "N/A";
  return `${Math.round(value)} ms`;
}

function formatCls(value) {
  if (typeof value !== "number") return "N/A";
  return value.toFixed(3);
}

function getAuditNumericValue(report, id) {
  const audit = report.audits?.[id];
  return typeof audit?.numericValue === "number" ? audit.numericValue : null;
}

function toRelativeForSummary(filePath) {
  return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadManifestCandidates() {
  const candidates = [];
  if (!(await fileExists(MANIFEST_PATH))) {
    return candidates;
  }

  const raw = await fs.readFile(MANIFEST_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("[LHCI_SUMMARY] manifest.json is not an array.");
  }

  for (const entry of parsed) {
    if (!isObject(entry) || typeof entry.jsonPath !== "string") continue;
    candidates.push({
      jsonPath: toAbsolutePath(entry.jsonPath),
      htmlPath: typeof entry.htmlPath === "string" ? toAbsolutePath(entry.htmlPath) : null,
      manifestUrl: typeof entry.url === "string" ? entry.url : null,
    });
  }

  return candidates;
}

async function loadFallbackCandidates() {
  const entries = await fs.readdir(OUTPUT_DIR, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.toLowerCase().endsWith(".json") &&
        entry.name.toLowerCase() !== "manifest.json"
    )
    .map((entry) => ({
      jsonPath: path.join(OUTPUT_DIR, entry.name),
      htmlPath: path.join(OUTPUT_DIR, entry.name.replace(/\.json$/i, ".html")),
      manifestUrl: null,
    }));
}

async function loadReports() {
  const manifestCandidates = await loadManifestCandidates();
  const fallbackCandidates = await loadFallbackCandidates();
  const byPath = new Map();

  for (const candidate of [...manifestCandidates, ...fallbackCandidates]) {
    byPath.set(path.resolve(candidate.jsonPath), candidate);
  }

  const candidates = Array.from(byPath.values());
  if (candidates.length === 0) {
    return { reports: [], warnings: [], noFilesFound: true };
  }

  const reports = [];
  const warnings = [];

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate.jsonPath, "utf8");
      const parsed = JSON.parse(raw);
      if (!isLighthouseReport(parsed)) {
        warnings.push(
          `[LHCI_SUMMARY] Skipped non-Lighthouse JSON file: ${toRelativeForSummary(candidate.jsonPath)}`
        );
        continue;
      }

      const finalUrl =
        (typeof parsed.finalUrl === "string" && parsed.finalUrl) ||
        candidate.manifestUrl ||
        (typeof parsed.requestedUrl === "string" ? parsed.requestedUrl : null) ||
        toRelativeForSummary(candidate.jsonPath);

      reports.push({
        finalUrl,
        performanceScore:
          typeof parsed.categories?.performance?.score === "number"
            ? parsed.categories.performance.score
            : null,
        lcp: getAuditNumericValue(parsed, "largest-contentful-paint"),
        cls: getAuditNumericValue(parsed, "cumulative-layout-shift"),
        tbt: getAuditNumericValue(parsed, "total-blocking-time"),
        jsonPath: candidate.jsonPath,
        htmlPath: candidate.htmlPath,
      });
    } catch (error) {
      warnings.push(
        `[LHCI_SUMMARY] Failed to parse ${toRelativeForSummary(candidate.jsonPath)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (reports.length === 0) {
    throw new Error(
      `[LHCI_SUMMARY] Found ${candidates.length} JSON file(s) but no valid Lighthouse reports.`
    );
  }

  return { reports, warnings, noFilesFound: false };
}

function buildNoFilesSummary() {
  const timestamp = new Date().toISOString();
  const baseUrl = process.env.LHCI_BASE_URL ?? "(not set)";
  return [
    "# Lighthouse CI Summary",
    "",
    `Generated: ${timestamp}`,
    `Base URL: ${baseUrl}`,
    "",
    "No Lighthouse JSON reports were found in `evidence-pack/02-performance/lighthouse/`.",
    "Run `npm run lhci` from `website/` to generate reports before building this summary.",
    "",
  ].join("\n");
}

function buildSummaryMarkdown(input) {
  const timestamp = new Date().toISOString();
  const baseUrl = process.env.LHCI_BASE_URL ?? "(not set)";
  const lines = [
    "# Lighthouse CI Summary",
    "",
    `Generated: ${timestamp}`,
    `Base URL: ${baseUrl}`,
    "",
  ];

  const sortedReports = [...input.reports].sort((a, b) => a.finalUrl.localeCompare(b.finalUrl));
  for (const report of sortedReports) {
    lines.push(`## ${report.finalUrl}`);
    lines.push("");
    lines.push(`- Performance score: ${formatScore(report.performanceScore)}`);
    lines.push(`- LCP: ${formatMs(report.lcp)}`);
    lines.push(`- CLS: ${formatCls(report.cls)}`);
    lines.push(`- TBT: ${formatMs(report.tbt)}`);
    lines.push(`- JSON report: \`${toRelativeForSummary(report.jsonPath)}\``);

    if (report.htmlPath) {
      lines.push(`- HTML report: \`${toRelativeForSummary(report.htmlPath)}\``);
    }
    lines.push("");
  }

  if (input.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const warning of input.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const result = await loadReports();
  const markdown = result.noFilesFound
    ? buildNoFilesSummary()
    : buildSummaryMarkdown(result);

  await fs.writeFile(SUMMARY_PATH, markdown, "utf8");
  console.log(`[LHCI_SUMMARY] Wrote ${toRelativeForSummary(SUMMARY_PATH)}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
