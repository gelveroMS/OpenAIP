import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.90.1";

const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_DIMS = 3072;
const MIN_TARGET_TOKENS = 200;
const MAX_TARGET_TOKENS = 800;
const GROUP_TARGET_TOKENS = 700;
const EMBED_RUN_ERROR_CODE = "EMBED_CATEGORIZE_FAILED";
const SKIP_NO_ARTIFACT_MESSAGE = "No categorize artifact; skipping.";
const MAX_CLOCK_SKEW_SECONDS = 60;
const DEFAULT_JOB_AUDIENCE = "embed-categorize-dispatcher";
const DEFAULT_NONCE_TTL_SECONDS = 120;
const DEFAULT_DEDUPE_TTL_SECONDS = 300;

// Process-local cache only. Multi-instance deployments need shared KV (Redis/DB)
// for strong replay and idempotency guarantees.
const NONCE_CACHE = new Map<string, number>();
const JOB_RESULT_CACHE = new Map<string, { expiresAt: number; response: Record<string, unknown> }>();
const JOB_INFLIGHT_CACHE = new Map<string, number>();

type PublishPayload = {
  aip_id?: string;
  request_id?: string | null;
  artifact_id?: string | null;
  published_at?: string | null;
  fiscal_year?: number | null;
  scope_type?: "barangay" | "city" | "municipality" | string | null;
  scope_id?: string | null;
  barangay_id?: string | null;
  city_id?: string | null;
  municipality_id?: string | null;
};

type AipContext = {
  fiscalYear: number | null;
  scopeType: "barangay" | "city" | "municipality" | "unknown";
  scopeId: string | null;
  scopeLabel: string;
};

type ChunkPlan = {
  chunkIndex: number;
  chunkText: string;
  metadata: Record<string, unknown>;
};

type PreparedProject = {
  ordinal: number;
  aipRefCode: string;
  description: string;
  category: "health" | "infrastructure" | "other";
  sectorCode: string;
  sectorLabel: string;
  fundingSource: string;
  ps: string;
  mooe: string;
  fe: string;
  co: string;
  total: string;
};

type ChunkRow = {
  id: string;
  chunk_index: number;
  chunk_text: string;
  metadata: Record<string, unknown> | null;
};

type EmbedRunStatusPatch = {
  status?: "queued" | "running" | "succeeded" | "failed";
  overall_progress_pct?: number | null;
  stage_progress_pct?: number | null;
  progress_message?: string | null;
  progress_updated_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  error_code?: string | null;
  error_message?: string | null;
};

const FALLBACK_SECTOR_LABELS: Record<string, string> = {
  "1000": "General Services",
  "3000": "Social Services",
  "8000": "Economic Services",
  "9000": "Other Services",
  unknown: "Unknown Sector",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function elapsedMs(startedAtMs: number): number {
  return Date.now() - startedAtMs;
}

function readIntEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function pruneNonceCache(nowMs: number): void {
  for (const [key, expiresAtMs] of NONCE_CACHE.entries()) {
    if (expiresAtMs <= nowMs) NONCE_CACHE.delete(key);
  }
}

function pruneJobCaches(nowMs: number): void {
  for (const [key, value] of JOB_RESULT_CACHE.entries()) {
    if (value.expiresAt <= nowMs) JOB_RESULT_CACHE.delete(key);
  }
  for (const [key, expiresAtMs] of JOB_INFLIGHT_CACHE.entries()) {
    if (expiresAtMs <= nowMs) JOB_INFLIGHT_CACHE.delete(key);
  }
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = Number.parseInt(hex.slice(i, i + 2), 16);
    if (!Number.isFinite(byte)) return null;
    out[i / 2] = byte;
  }
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

async function hmacSha256(secret: string, payload: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return new Uint8Array(signature);
}

function buildCanonical(aud: string, ts: string, nonce: string, rawBody: string): string {
  return `${aud}|${ts}|${nonce}|${rawBody}`;
}

function resolveJobKey(payload: PublishPayload): string | null {
  const artifactId = normalizeString(payload.artifact_id, "");
  if (artifactId) return `artifact:${artifactId}`;
  const requestId = normalizeString(payload.request_id, "");
  if (requestId) return `request:${requestId}`;
  return null;
}

function logEvent(
  event: string,
  payload: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      event,
      ts: nowIso(),
      ...payload,
    }),
  );
}

function normalizeString(value: unknown, fallback = "N/A"): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeCategory(value: unknown): "health" | "infrastructure" | "other" {
  const lowered = normalizeString(value, "other").toLowerCase();
  if (lowered === "health" || lowered === "healthcare") return "health";
  if (lowered === "infrastructure") return "infrastructure";
  return "other";
}

function inferSectorCode(aipRefCode: string): string {
  const normalized = aipRefCode.replace(/\s+/g, "");
  if (normalized.startsWith("1000")) return "1000";
  if (normalized.startsWith("3000")) return "3000";
  if (normalized.startsWith("8000")) return "8000";
  if (normalized.startsWith("9000")) return "9000";
  return "unknown";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[,\s]/g, "").replace(/[()]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return value.includes("(") && value.includes(")") ? -parsed : parsed;
}

function formatAmount(value: unknown): string {
  const parsed = toNumber(value);
  if (parsed === null) return "N/A";
  return parsed.toFixed(2);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function compareProjects(a: PreparedProject, b: PreparedProject): number {
  const ref = a.aipRefCode.localeCompare(b.aipRefCode);
  if (ref !== 0) return ref;
  const desc = a.description.localeCompare(b.description);
  if (desc !== 0) return desc;
  return a.ordinal - b.ordinal;
}

function categoryOrder(category: string): number {
  if (category === "health") return 0;
  if (category === "infrastructure") return 1;
  if (category === "other") return 2;
  return 3;
}

function extractProjects(
  projectsRaw: unknown[],
  sectorLabels: Map<string, string>,
): PreparedProject[] {
  const prepared: PreparedProject[] = [];
  for (let index = 0; index < projectsRaw.length; index += 1) {
    const raw = projectsRaw[index];
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const amounts =
      row.amounts && typeof row.amounts === "object"
        ? (row.amounts as Record<string, unknown>)
        : {};
    const classification =
      row.classification && typeof row.classification === "object"
        ? (row.classification as Record<string, unknown>)
        : {};

    const aipRefCode = normalizeString(row.aip_ref_code, `UNSPECIFIED-${index + 1}`);
    const description = normalizeString(row.program_project_description);
    const category = normalizeCategory(classification.category ?? row.category);
    const sectorCode = normalizeString(
      classification.sector_code,
      inferSectorCode(aipRefCode),
    );
    const sectorLabel = sectorLabels.get(sectorCode) ?? FALLBACK_SECTOR_LABELS[sectorCode] ?? "Unknown Sector";

    prepared.push({
      ordinal: index,
      aipRefCode,
      description,
      category,
      sectorCode,
      sectorLabel,
      fundingSource: normalizeString(row.source_of_funds),
      ps: formatAmount(amounts.personal_services ?? row.personal_services),
      mooe: formatAmount(
        amounts.maintenance_and_other_operating_expenses ??
          row.maintenance_and_other_operating_expenses,
      ),
      fe: formatAmount(amounts.financial_expenses ?? row.financial_expenses),
      co: formatAmount(amounts.capital_outlay ?? row.capital_outlay),
      total: formatAmount(amounts.total ?? row.total),
    });
  }

  prepared.sort(compareProjects);
  return prepared;
}

function formatProjectChunkText(
  project: PreparedProject,
  context: AipContext,
  artifactId: string,
): string {
  const fy = context.fiscalYear ?? "N/A";
  return [
    `AIP Categorization | FY=${fy} | Scope=${context.scopeLabel}`,
    `Project: ${project.aipRefCode} - ${project.description}`,
    `Sector: ${project.sectorCode} (${project.sectorLabel})`,
    `Category: ${project.category}`,
    `Amounts: PS=${project.ps}, MOOE=${project.mooe}, FE=${project.fe}, CO=${project.co}, Total=${project.total}`,
    `Funding Source: ${project.fundingSource}`,
    `Source: categorize artifact ${artifactId}`,
  ].join("\n");
}

function formatGroupedProjectLine(project: PreparedProject): string {
  return [
    `- ${project.aipRefCode} | ${project.description}`,
    `  Sector=${project.sectorCode} (${project.sectorLabel})`,
    `  Amounts=PS:${project.ps}, MOOE:${project.mooe}, FE:${project.fe}, CO:${project.co}, Total:${project.total}`,
    `  Funding=${project.fundingSource}`,
  ].join("\n");
}

function formatCategoryChunkText(
  category: string,
  part: number,
  lines: string[],
  context: AipContext,
  artifactId: string,
): string {
  const fy = context.fiscalYear ?? "N/A";
  return [
    `AIP Categorization | FY=${fy} | Scope=${context.scopeLabel}`,
    `Category Group: ${category} (part ${part})`,
    "Projects:",
    ...lines,
    `Source: categorize artifact ${artifactId}`,
  ].join("\n");
}

function buildGroupedChunks(
  projects: PreparedProject[],
  context: AipContext,
  artifactId: string,
): Array<{ chunkText: string; category: string }> {
  const groups = new Map<string, PreparedProject[]>();
  for (const project of projects) {
    const key = project.category;
    const current = groups.get(key) ?? [];
    current.push(project);
    groups.set(key, current);
  }

  const groupedChunks: Array<{ chunkText: string; category: string }> = [];
  const orderedCategories = [...groups.keys()].sort((a, b) => {
    const orderDiff = categoryOrder(a) - categoryOrder(b);
    if (orderDiff !== 0) return orderDiff;
    return a.localeCompare(b);
  });

  for (const category of orderedCategories) {
    const projectsInCategory = [...(groups.get(category) ?? [])].sort(compareProjects);
    let part = 1;
    let currentLines: string[] = [];

    for (const project of projectsInCategory) {
      const candidateLines = [...currentLines, formatGroupedProjectLine(project)];
      const candidateText = formatCategoryChunkText(
        category,
        part,
        candidateLines,
        context,
        artifactId,
      );
      const candidateTokens = estimateTokens(candidateText);

      if (
        currentLines.length > 0 &&
        candidateTokens > MAX_TARGET_TOKENS &&
        estimateTokens(formatCategoryChunkText(category, part, currentLines, context, artifactId)) >=
          MIN_TARGET_TOKENS
      ) {
        groupedChunks.push({
          chunkText: formatCategoryChunkText(category, part, currentLines, context, artifactId),
          category,
        });
        part += 1;
        currentLines = [formatGroupedProjectLine(project)];
        continue;
      }

      if (
        currentLines.length > 0 &&
        candidateTokens > GROUP_TARGET_TOKENS &&
        estimateTokens(formatCategoryChunkText(category, part, currentLines, context, artifactId)) >=
          MIN_TARGET_TOKENS
      ) {
        groupedChunks.push({
          chunkText: formatCategoryChunkText(category, part, currentLines, context, artifactId),
          category,
        });
        part += 1;
        currentLines = [formatGroupedProjectLine(project)];
        continue;
      }

      currentLines = candidateLines;
    }

    if (currentLines.length > 0) {
      groupedChunks.push({
        chunkText: formatCategoryChunkText(category, part, currentLines, context, artifactId),
        category,
      });
    }
  }

  return groupedChunks;
}

export function buildChunkPlan(args: {
  projectsRaw: unknown[];
  context: AipContext;
  artifactId: string;
  artifactRunId: string;
  aipId: string;
  scopeType: "barangay" | "city" | "municipality" | "unknown";
  scopeId: string | null;
  sectorLabels: Map<string, string>;
}): ChunkPlan[] {
  const projects = extractProjects(args.projectsRaw, args.sectorLabels);
  if (projects.length === 0) return [];

  const projectChunks = projects.map((project) => {
    const chunkText = formatProjectChunkText(project, args.context, args.artifactId);
    return {
      project,
      chunkText,
      tokens: estimateTokens(chunkText),
    };
  });

  const inTarget = projectChunks.filter(
    (chunk) => chunk.tokens >= MIN_TARGET_TOKENS && chunk.tokens <= MAX_TARGET_TOKENS,
  ).length;
  const inTargetRatio = projectChunks.length > 0 ? inTarget / projectChunks.length : 0;
  const useProjectChunks = projectChunks.length <= 3 || inTargetRatio >= 0.6;

  const baseMetadata = {
    source: "categorize_artifact",
    artifact_id: args.artifactId,
    artifact_run_id: args.artifactRunId,
    artifact_type: "categorize",
    fiscal_year: args.context.fiscalYear,
    scope_type: args.scopeType,
    scope_id: args.scopeId,
  };

  if (useProjectChunks) {
    return projectChunks.map((chunk, idx) => ({
      chunkIndex: idx,
      chunkText: chunk.chunkText,
      metadata: {
        ...baseMetadata,
        chunk_kind: "project",
        project_ref: chunk.project.aipRefCode,
      },
    }));
  }

  const grouped = buildGroupedChunks(projects, args.context, args.artifactId);
  return grouped.map((groupedChunk, idx) => ({
    chunkIndex: idx,
    chunkText: groupedChunk.chunkText,
    metadata: {
      ...baseMetadata,
      chunk_kind: "category_group",
    },
  }));
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value).toString()).join(",")}]`;
}

async function fetchSectorLabels(supabase: SupabaseClient): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const { data, error } = await supabase.from("sectors").select("code,label");
  if (error) {
    throw new Error(`Failed to load sectors: ${error.message}`);
  }
  for (const row of data ?? []) {
    const code = normalizeString((row as Record<string, unknown>).code, "");
    const label = normalizeString((row as Record<string, unknown>).label, "");
    if (!code || !label) continue;
    labels.set(code, label);
  }
  for (const [code, label] of Object.entries(FALLBACK_SECTOR_LABELS)) {
    if (!labels.has(code)) labels.set(code, label);
  }
  return labels;
}

async function createEmbedRun(
  supabase: SupabaseClient,
  aipId: string,
): Promise<string> {
  const startedAt = nowIso();
  const { data, error } = await supabase
    .from("extraction_runs")
    .insert({
      aip_id: aipId,
      stage: "embed",
      status: "running",
      model_name: EMBEDDING_MODEL,
      started_at: startedAt,
      overall_progress_pct: 1,
      stage_progress_pct: 1,
      progress_message: "Starting search indexing from categorize artifact.",
      progress_updated_at: startedAt,
      error_code: null,
      error_message: null,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(`Failed to create embed run: ${error?.message ?? "missing run id"}`);
  }

  const runId = normalizeString((data as Record<string, unknown>).id, "");
  if (!runId) {
    throw new Error("Failed to create embed run: invalid run id.");
  }
  return runId;
}

async function patchEmbedRun(
  supabase: SupabaseClient,
  runId: string,
  patch: EmbedRunStatusPatch,
): Promise<void> {
  const { error } = await supabase
    .from("extraction_runs")
    .update(patch)
    .eq("id", runId);
  if (error) {
    throw new Error(`Failed to update embed run status: ${error.message}`);
  }
}

async function markEmbedRunSucceeded(
  supabase: SupabaseClient,
  runId: string,
  message: string,
): Promise<void> {
  const finishedAt = nowIso();
  await patchEmbedRun(supabase, runId, {
    status: "succeeded",
    overall_progress_pct: 100,
    stage_progress_pct: 100,
    progress_message: message,
    progress_updated_at: finishedAt,
    finished_at: finishedAt,
    error_code: null,
    error_message: null,
  });
}

async function markEmbedRunFailed(
  supabase: SupabaseClient,
  runId: string,
  message: string,
): Promise<void> {
  const finishedAt = nowIso();
  await patchEmbedRun(supabase, runId, {
    status: "failed",
    overall_progress_pct: 100,
    stage_progress_pct: 100,
    progress_message: "Search indexing failed.",
    progress_updated_at: finishedAt,
    finished_at: finishedAt,
    error_code: EMBED_RUN_ERROR_CODE,
    error_message: message,
  });
}

async function resolveAipContext(
  supabase: SupabaseClient,
  aipId: string,
  payload: PublishPayload,
): Promise<AipContext> {
  const { data, error } = await supabase
    .from("aips")
    .select(
      "id,fiscal_year,barangay_id,city_id,municipality_id,barangay:barangays!aips_barangay_id_fkey(name),city:cities!aips_city_id_fkey(name),municipality:municipalities!aips_municipality_id_fkey(name)",
    )
    .eq("id", aipId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load AIP context: ${error.message}`);
  }

  const row = (data ?? null) as Record<string, unknown> | null;
  const fiscalYear =
    typeof row?.fiscal_year === "number"
      ? row.fiscal_year
      : typeof payload.fiscal_year === "number"
        ? payload.fiscal_year
        : null;

  const barangayId = normalizeString(row?.barangay_id ?? payload.barangay_id, "");
  const cityId = normalizeString(row?.city_id ?? payload.city_id, "");
  const municipalityId = normalizeString(row?.municipality_id ?? payload.municipality_id, "");

  if (barangayId) {
    const barangayName = normalizeString(
      (row?.barangay as Record<string, unknown> | undefined)?.name,
      barangayId,
    );
    return {
      fiscalYear,
      scopeType: "barangay",
      scopeId: barangayId,
      scopeLabel: `Barangay: ${barangayName}`,
    };
  }
  if (cityId) {
    const cityName = normalizeString((row?.city as Record<string, unknown> | undefined)?.name, cityId);
    return {
      fiscalYear,
      scopeType: "city",
      scopeId: cityId,
      scopeLabel: `City: ${cityName}`,
    };
  }
  if (municipalityId) {
    const municipalityName = normalizeString(
      (row?.municipality as Record<string, unknown> | undefined)?.name,
      municipalityId,
    );
    return {
      fiscalYear,
      scopeType: "municipality",
      scopeId: municipalityId,
      scopeLabel: `Municipality: ${municipalityName}`,
    };
  }

  return {
    fiscalYear,
    scopeType: "unknown",
    scopeId: normalizeString(payload.scope_id, "") || null,
    scopeLabel: "Unknown LGU",
  };
}

async function resolveCurrentUploadedFileId(
  supabase: SupabaseClient,
  aipId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("uploaded_files")
    .select("id,created_at")
    .eq("aip_id", aipId)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Failed to resolve uploaded file: ${error.message}`);
  }
  const row = data?.[0] as Record<string, unknown> | undefined;
  return row ? normalizeString(row.id, "") || null : null;
}

async function selectLatestSucceededCategorizeArtifact(
  supabase: SupabaseClient,
  aipId: string,
): Promise<Record<string, unknown> | null> {
  const { data: artifacts, error: artifactsError } = await supabase
    .from("extraction_artifacts")
    .select("id,run_id,aip_id,created_at,artifact_json")
    .eq("aip_id", aipId)
    .eq("artifact_type", "categorize")
    .order("created_at", { ascending: false })
    .limit(50);

  if (artifactsError) {
    throw new Error(`Failed to load categorize artifacts: ${artifactsError.message}`);
  }

  if (!artifacts || artifacts.length === 0) return null;

  const runIds = [
    ...new Set(
      artifacts
        .map((row) => normalizeString((row as Record<string, unknown>).run_id, ""))
        .filter((id) => id.length > 0),
    ),
  ];

  if (runIds.length === 0) return null;

  const { data: runs, error: runsError } = await supabase
    .from("extraction_runs")
    .select("id,status")
    .in("id", runIds);

  if (runsError) {
    throw new Error(`Failed to load extraction runs: ${runsError.message}`);
  }

  const runStatusById = new Map<string, string>();
  for (const run of runs ?? []) {
    const runRow = run as Record<string, unknown>;
    const id = normalizeString(runRow.id, "");
    const status = normalizeString(runRow.status, "");
    if (!id) continue;
    runStatusById.set(id, status);
  }

  for (const artifact of artifacts) {
    const row = artifact as Record<string, unknown>;
    const runId = normalizeString(row.run_id, "");
    if (!runId || runStatusById.get(runId) !== "succeeded") continue;
    const artifactJson = row.artifact_json;
    if (!artifactJson || typeof artifactJson !== "object") continue;
    const projects = (artifactJson as Record<string, unknown>).projects;
    if (!Array.isArray(projects)) continue;
    return row;
  }

  return null;
}

function isCategorizeArtifactChunk(
  chunk: ChunkRow,
  artifactId: string,
): boolean {
  const metadata = chunk.metadata;
  if (!metadata || typeof metadata !== "object") return false;
  return (
    (metadata as Record<string, unknown>).source === "categorize_artifact" &&
    String((metadata as Record<string, unknown>).artifact_id ?? "") === artifactId
  );
}

async function loadArtifactChunks(
  supabase: SupabaseClient,
  aipId: string,
  runId: string,
  artifactId: string,
): Promise<ChunkRow[]> {
  const { data, error } = await supabase
    .from("aip_chunks")
    .select("id,chunk_index,chunk_text,metadata")
    .eq("aip_id", aipId)
    .eq("run_id", runId)
    .order("chunk_index", { ascending: true });

  if (error) {
    throw new Error(`Failed to load existing chunks: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => row as ChunkRow)
    .filter((row) => isCategorizeArtifactChunk(row, artifactId));
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = requireEnv("OPENAI_API_KEY");
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMS,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI embeddings request failed (${response.status}): ${detail}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ index: number; embedding: number[] }>;
  };
  if (!Array.isArray(payload.data)) {
    throw new Error("OpenAI embeddings response missing data array.");
  }

  const sorted = [...payload.data].sort((a, b) => a.index - b.index);
  const vectors = sorted.map((entry) => entry.embedding);
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) {
      throw new Error(
        `Embedding dimension mismatch: expected ${EMBEDDING_DIMS}, got ${Array.isArray(vector) ? vector.length : "invalid"}.`,
      );
    }
  }
  return vectors;
}

async function insertMissingEmbeddings(
  supabase: SupabaseClient,
  aipId: string,
  chunks: ChunkRow[],
): Promise<number> {
  if (chunks.length === 0) return 0;

  const chunkIds = chunks.map((chunk) => chunk.id);
  const { data: existingEmbeddings, error: existingError } = await supabase
    .from("aip_chunk_embeddings")
    .select("chunk_id")
    .in("chunk_id", chunkIds);

  if (existingError) {
    throw new Error(`Failed to load existing embeddings: ${existingError.message}`);
  }

  const existingSet = new Set<string>(
    (existingEmbeddings ?? []).map((row) =>
      normalizeString((row as Record<string, unknown>).chunk_id, ""),
    ),
  );

  const missing = chunks.filter((chunk) => !existingSet.has(chunk.id));
  if (missing.length === 0) return 0;

  const batchSize = 16;
  let inserted = 0;
  for (let start = 0; start < missing.length; start += batchSize) {
    const slice = missing.slice(start, start + batchSize);
    const vectors = await embedTexts(slice.map((row) => row.chunk_text));
    const rows = slice.map((chunk, index) => ({
      chunk_id: chunk.id,
      aip_id: aipId,
      embedding: vectorLiteral(vectors[index]),
      embedding_model: EMBEDDING_MODEL,
    }));

    const { error: insertError } = await supabase
      .from("aip_chunk_embeddings")
      .upsert(rows, {
        onConflict: "chunk_id",
        ignoreDuplicates: true,
      });

    if (insertError) {
      throw new Error(`Failed to insert chunk embeddings: ${insertError.message}`);
    }
    inserted += rows.length;
  }

  return inserted;
}

export async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed. Use POST." });
  }

  const startedAtMs = Date.now();
  const nonceTtlMs = readIntEnv("EMBED_CATEGORIZE_NONCE_TTL_SECONDS", DEFAULT_NONCE_TTL_SECONDS) * 1000;
  const dedupeTtlMs = readIntEnv("EMBED_CATEGORIZE_DEDUPE_TTL_SECONDS", DEFAULT_DEDUPE_TTL_SECONDS) * 1000;
  const audience =
    normalizeString(Deno.env.get("EMBED_CATEGORIZE_JOB_AUDIENCE"), DEFAULT_JOB_AUDIENCE) ||
    DEFAULT_JOB_AUDIENCE;
  const expectedSecret = Deno.env.get("EMBED_CATEGORIZE_JOB_SECRET") ?? "";

  let payload: PublishPayload;
  let requestId: string | null = null;
  let requestArtifactId: string | null = null;
  let loggedArtifactId: string | null = null;
  let aipId = "";
  let jobKey: string | null = null;

  const logWithContext = (event: string, payloadFields: Record<string, unknown>): void => {
    logEvent(event, {
      request_id: requestId,
      artifact_id: loggedArtifactId ?? requestArtifactId,
      ...payloadFields,
    });
  };

  const rawBody = await request.text();
  const ts = normalizeString(request.headers.get("x-job-ts"), "");
  const nonce = normalizeString(request.headers.get("x-job-nonce"), "");
  const providedSigHex = normalizeString(request.headers.get("x-job-sig"), "").toLowerCase();

  if (!expectedSecret || !ts || !nonce || !providedSigHex) {
    logWithContext("embed_categorize.auth.failed", {
      reason: !expectedSecret ? "missing_server_secret_or_header" : "missing_header",
      elapsed_ms: elapsedMs(startedAtMs),
    });
    return json(401, { error: "Unauthorized." });
  }

  if (!/^\d+$/.test(ts)) {
    logWithContext("embed_categorize.auth.failed", {
      reason: "invalid_timestamp",
      elapsed_ms: elapsedMs(startedAtMs),
    });
    return json(401, { error: "Unauthorized." });
  }
  const tsSeconds = Number.parseInt(ts, 10);

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - tsSeconds) > MAX_CLOCK_SKEW_SECONDS) {
    logWithContext("embed_categorize.auth.failed", {
      reason: "stale_timestamp",
      elapsed_ms: elapsedMs(startedAtMs),
    });
    return json(401, { error: "Unauthorized." });
  }

  const providedSig = hexToBytes(providedSigHex);
  if (!providedSig) {
    logWithContext("embed_categorize.auth.failed", {
      reason: "invalid_signature_format",
      elapsed_ms: elapsedMs(startedAtMs),
    });
    return json(401, { error: "Unauthorized." });
  }

  const canonical = buildCanonical(audience, ts, nonce, rawBody);
  const expectedSig = await hmacSha256(expectedSecret, canonical);
  if (!constantTimeEqual(providedSig, expectedSig)) {
    logWithContext("embed_categorize.auth.failed", {
      reason: "invalid_signature",
      elapsed_ms: elapsedMs(startedAtMs),
    });
    return json(401, { error: "Unauthorized." });
  }

  const nonceKey = `${audience}|${nonce}`;
  const nowMsForNonce = Date.now();
  pruneNonceCache(nowMsForNonce);
  const replayedNonce = NONCE_CACHE.get(nonceKey);
  if (replayedNonce && replayedNonce > nowMsForNonce) {
    logWithContext("embed_categorize.replay.rejected", {
      nonce,
      elapsed_ms: elapsedMs(startedAtMs),
    });
    return json(401, { error: "Unauthorized." });
  }
  NONCE_CACHE.set(nonceKey, nowMsForNonce + nonceTtlMs);

  try {
    payload = JSON.parse(rawBody) as PublishPayload;
  } catch {
    return json(400, { error: "Invalid JSON payload." });
  }

  requestId = normalizeString(payload.request_id, "") || null;
  requestArtifactId = normalizeString(payload.artifact_id, "") || null;
  loggedArtifactId = requestArtifactId;
  aipId = normalizeString(payload.aip_id, "");

  if (!aipId) {
    return json(400, { error: "Missing required field: aip_id." });
  }
  if (!requestId && !requestArtifactId) {
    return json(400, { error: "Missing required field: request_id or artifact_id." });
  }

  jobKey = resolveJobKey(payload);
  if (!jobKey) {
    return json(400, { error: "Missing required field: request_id or artifact_id." });
  }

  const idempotentResponseBase = {
    ok: true,
    idempotent: true,
    request_id: requestId,
    artifact_id: requestArtifactId,
    job_key: jobKey,
  };

  const nowMsForJobs = Date.now();
  pruneJobCaches(nowMsForJobs);
  const cachedResult = JOB_RESULT_CACHE.get(jobKey);
  if (cachedResult && cachedResult.expiresAt > nowMsForJobs) {
    logWithContext("embed_categorize.idempotent.hit", {
      aip_id: aipId,
      job_key: jobKey,
      status: "completed",
      elapsed_ms: elapsedMs(startedAtMs),
    });
    return json(200, {
      ...idempotentResponseBase,
      status: "completed",
      result: cachedResult.response,
    });
  }

  const inflightUntil = JOB_INFLIGHT_CACHE.get(jobKey);
  if (inflightUntil && inflightUntil > nowMsForJobs) {
    logWithContext("embed_categorize.idempotent.hit", {
      aip_id: aipId,
      job_key: jobKey,
      status: "in_progress",
      elapsed_ms: elapsedMs(startedAtMs),
    });
    return json(200, {
      ...idempotentResponseBase,
      status: "in_progress",
    });
  }

  JOB_INFLIGHT_CACHE.set(jobKey, nowMsForJobs + dedupeTtlMs);

  const cacheJobResult = (response: Record<string, unknown>): void => {
    if (!jobKey) return;
    JOB_RESULT_CACHE.set(jobKey, {
      expiresAt: Date.now() + dedupeTtlMs,
      response,
    });
  };

  let supabase: SupabaseClient | null = null;
  let embedRunId: string | null = null;
  let artifactId: string | null = null;
  let artifactRunId: string | null = null;

  logWithContext("embed_categorize.request.received", {
    aip_id: aipId,
    fiscal_year: payload.fiscal_year ?? null,
    scope_type: payload.scope_type ?? null,
  });

  try {
    const supabaseUrl = requireEnv("SUPABASE_URL");
    const supabaseServiceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    embedRunId = await createEmbedRun(supabase, aipId);
    logWithContext("embed_categorize.run.created", {
      aip_id: aipId,
      embed_run_id: embedRunId,
      elapsed_ms: elapsedMs(startedAtMs),
    });

    await patchEmbedRun(supabase, embedRunId, {
      overall_progress_pct: 10,
      stage_progress_pct: 10,
      progress_message: "Loading latest categorize artifact.",
      progress_updated_at: nowIso(),
    });

    const artifact = await selectLatestSucceededCategorizeArtifact(supabase, aipId);
    if (!artifact) {
      await markEmbedRunSucceeded(supabase, embedRunId, SKIP_NO_ARTIFACT_MESSAGE);
      logWithContext("embed_categorize.skipped.no_artifact", {
        aip_id: aipId,
        embed_run_id: embedRunId,
        elapsed_ms: elapsedMs(startedAtMs),
      });
      const responseBody = {
        message: SKIP_NO_ARTIFACT_MESSAGE,
        aip_id: aipId,
        run_id: embedRunId,
        request_id: requestId,
        artifact_id: requestArtifactId,
      };
      cacheJobResult(responseBody);
      return json(202, responseBody);
    }

    artifactId = normalizeString(artifact.id, "");
    artifactRunId = normalizeString(artifact.run_id, "");
    if (artifactId) loggedArtifactId = artifactId;
    if (!artifactId || !artifactRunId) {
      await markEmbedRunSucceeded(supabase, embedRunId, SKIP_NO_ARTIFACT_MESSAGE);
      logWithContext("embed_categorize.skipped.invalid_artifact_identity", {
        aip_id: aipId,
        embed_run_id: embedRunId,
        elapsed_ms: elapsedMs(startedAtMs),
      });
      const responseBody = {
        message: SKIP_NO_ARTIFACT_MESSAGE,
        aip_id: aipId,
        run_id: embedRunId,
        request_id: requestId,
        artifact_id: requestArtifactId,
      };
      cacheJobResult(responseBody);
      return json(202, responseBody);
    }

    await patchEmbedRun(supabase, embedRunId, {
      overall_progress_pct: 20,
      stage_progress_pct: 20,
      progress_message: "Categorize artifact selected.",
      progress_updated_at: nowIso(),
    });
    logWithContext("embed_categorize.artifact.selected", {
      aip_id: aipId,
      embed_run_id: embedRunId,
      artifact_id: artifactId,
      artifact_run_id: artifactRunId,
      elapsed_ms: elapsedMs(startedAtMs),
    });

    const artifactJson = artifact.artifact_json as Record<string, unknown>;
    const projectsRaw = Array.isArray(artifactJson.projects) ? artifactJson.projects : [];
    if (projectsRaw.length === 0) {
      await markEmbedRunSucceeded(supabase, embedRunId, SKIP_NO_ARTIFACT_MESSAGE);
      logWithContext("embed_categorize.skipped.empty_projects", {
        aip_id: aipId,
        embed_run_id: embedRunId,
        artifact_id: artifactId,
        artifact_run_id: artifactRunId,
        elapsed_ms: elapsedMs(startedAtMs),
      });
      const responseBody = {
        message: SKIP_NO_ARTIFACT_MESSAGE,
        aip_id: aipId,
        run_id: embedRunId,
        request_id: requestId,
        artifact_id: artifactId,
      };
      cacheJobResult(responseBody);
      return json(202, responseBody);
    }

    await patchEmbedRun(supabase, embedRunId, {
      overall_progress_pct: 30,
      stage_progress_pct: 30,
      progress_message: "Preparing chunk metadata and context.",
      progress_updated_at: nowIso(),
    });

    const sectorLabels = await fetchSectorLabels(supabase);
    const context = await resolveAipContext(supabase, aipId, payload);
    const uploadedFileId = await resolveCurrentUploadedFileId(supabase, aipId);

    const existingBefore = await loadArtifactChunks(supabase, aipId, artifactRunId, artifactId);
    await patchEmbedRun(supabase, embedRunId, {
      overall_progress_pct: 45,
      stage_progress_pct: 45,
      progress_message: "Building retrieval chunk plan.",
      progress_updated_at: nowIso(),
    });
    const chunkPlan = buildChunkPlan({
      projectsRaw,
      context,
      artifactId,
      artifactRunId,
      aipId,
      scopeType: context.scopeType,
      scopeId: context.scopeId,
      sectorLabels,
    });

    if (chunkPlan.length === 0) {
      await markEmbedRunSucceeded(supabase, embedRunId, SKIP_NO_ARTIFACT_MESSAGE);
      logWithContext("embed_categorize.skipped.empty_chunk_plan", {
        aip_id: aipId,
        embed_run_id: embedRunId,
        artifact_id: artifactId,
        artifact_run_id: artifactRunId,
        elapsed_ms: elapsedMs(startedAtMs),
      });
      const responseBody = {
        message: SKIP_NO_ARTIFACT_MESSAGE,
        aip_id: aipId,
        run_id: embedRunId,
        request_id: requestId,
        artifact_id: artifactId,
      };
      cacheJobResult(responseBody);
      return json(202, responseBody);
    }

    logWithContext("embed_categorize.chunks.planned", {
      aip_id: aipId,
      embed_run_id: embedRunId,
      artifact_id: artifactId,
      artifact_run_id: artifactRunId,
      chunks_planned: chunkPlan.length,
      elapsed_ms: elapsedMs(startedAtMs),
    });

    const rows = chunkPlan.map((chunk) => ({
      aip_id: aipId,
      uploaded_file_id: uploadedFileId,
      run_id: artifactRunId,
      chunk_index: chunk.chunkIndex,
      chunk_text: chunk.chunkText,
      metadata: chunk.metadata,
    }));

    await patchEmbedRun(supabase, embedRunId, {
      overall_progress_pct: 60,
      stage_progress_pct: 60,
      progress_message: "Writing chunk rows.",
      progress_updated_at: nowIso(),
    });
    const { error: chunkUpsertError } = await supabase.from("aip_chunks").upsert(rows, {
      onConflict: "aip_id,run_id,chunk_index",
      ignoreDuplicates: true,
    });
    if (chunkUpsertError) {
      throw new Error(`Failed to upsert aip chunks: ${chunkUpsertError.message}`);
    }
    logWithContext("embed_categorize.chunks.upserted", {
      aip_id: aipId,
      embed_run_id: embedRunId,
      artifact_id: artifactId,
      artifact_run_id: artifactRunId,
      rows_attempted: rows.length,
      elapsed_ms: elapsedMs(startedAtMs),
    });

    await patchEmbedRun(supabase, embedRunId, {
      overall_progress_pct: 75,
      stage_progress_pct: 75,
      progress_message: "Loading chunks for embedding.",
      progress_updated_at: nowIso(),
    });
    const chunkRows = await loadArtifactChunks(supabase, aipId, artifactRunId, artifactId);
    if (chunkRows.length === 0) {
      throw new Error(
        "Chunk upsert completed but no categorize_artifact chunks were readable for the selected artifact.",
      );
    }

    await patchEmbedRun(supabase, embedRunId, {
      overall_progress_pct: 85,
      stage_progress_pct: 85,
      progress_message: "Computing embeddings.",
      progress_updated_at: nowIso(),
    });
    const embeddingsNew = await insertMissingEmbeddings(supabase, aipId, chunkRows);
    logWithContext("embed_categorize.embeddings.inserted", {
      aip_id: aipId,
      embed_run_id: embedRunId,
      artifact_id: artifactId,
      artifact_run_id: artifactRunId,
      chunks_total: chunkRows.length,
      embeddings_new: embeddingsNew,
      elapsed_ms: elapsedMs(startedAtMs),
    });

    await markEmbedRunSucceeded(supabase, embedRunId, "Search indexing complete.");
    logWithContext("embed_categorize.completed", {
      aip_id: aipId,
      embed_run_id: embedRunId,
      artifact_id: artifactId,
      artifact_run_id: artifactRunId,
      chunks_total: chunkRows.length,
      chunks_new: Math.max(0, chunkRows.length - existingBefore.length),
      embeddings_new: embeddingsNew,
      elapsed_ms: elapsedMs(startedAtMs),
    });

    const responseBody = {
      ok: true,
      aip_id: aipId,
      artifact_id: artifactId,
      request_id: requestId,
      run_id: embedRunId,
      chunks_total: chunkRows.length,
      chunks_new: Math.max(0, chunkRows.length - existingBefore.length),
      embeddings_new: embeddingsNew,
    };
    cacheJobResult(responseBody);
    return json(200, responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logWithContext("embed_categorize.failed", {
      aip_id: aipId,
      embed_run_id: embedRunId,
      artifact_id: artifactId,
      artifact_run_id: artifactRunId,
      error: message,
      elapsed_ms: elapsedMs(startedAtMs),
    });

    if (supabase && embedRunId) {
      try {
        await markEmbedRunFailed(supabase, embedRunId, message);
      } catch (runPatchError) {
        logWithContext("embed_categorize.run_patch_failed", {
          aip_id: aipId,
          embed_run_id: embedRunId,
          error:
            runPatchError instanceof Error
              ? runPatchError.message
              : "Unknown run patch error",
          elapsed_ms: elapsedMs(startedAtMs),
        });
      }
    }

    return json(500, {
      error: message,
      aip_id: aipId,
      run_id: embedRunId,
      request_id: requestId,
      artifact_id: artifactId ?? requestArtifactId,
    });
  } finally {
    if (jobKey) {
      JOB_INFLIGHT_CACHE.delete(jobKey);
    }
  }
}

if (import.meta.main) {
  Deno.serve((request) => handleRequest(request));
}
