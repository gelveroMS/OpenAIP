import {
  collectInChunks,
  dedupeNonEmptyStrings,
} from "@/lib/repos/_shared/supabase-batching";

export type AipIdAmountRow = {
  aip_id: string;
  total: unknown;
};

type AipTotalsQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      in: (
        column: string,
        values: string[]
      ) => Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
  };
};

type AipTotalsSelectRow = {
  aip_id?: unknown;
  total_investment_program?: unknown;
};

export function parseAipTotalInvestmentProgram(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/,/g, "").trim();
  const direct = Number(normalized);
  if (Number.isFinite(direct)) return direct;

  const cleaned = normalized.replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toSafeAmount(value: unknown): number {
  const parsed = parseAipTotalInvestmentProgram(value);
  return parsed ?? 0;
}

export function buildProjectTotalsByAipId(
  rows: AipIdAmountRow[]
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = typeof row.aip_id === "string" ? row.aip_id : "";
    if (!key) continue;
    const amount = toSafeAmount(row.total);
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }
  return totals;
}

export function resolveAipDisplayTotal(input: {
  aipId: string;
  fileTotalsByAipId: ReadonlyMap<string, number>;
  fallbackTotalsByAipId?: ReadonlyMap<string, number>;
}): number {
  const fileTotal = input.fileTotalsByAipId.get(input.aipId);
  const fallbackTotal = input.fallbackTotalsByAipId?.get(input.aipId);
  const hasFileTotal = typeof fileTotal === "number" && Number.isFinite(fileTotal);
  const hasFallbackTotal =
    typeof fallbackTotal === "number" && Number.isFinite(fallbackTotal);

  if (
    hasFileTotal &&
    hasFallbackTotal &&
    fileTotal > 0 &&
    fallbackTotal > fileTotal
  ) {
    return fallbackTotal;
  }
  if (hasFileTotal) return fileTotal;
  if (hasFallbackTotal) return fallbackTotal;
  return 0;
}

export function resolveAipDisplayTotalsByAipId(input: {
  aipIds: Iterable<string>;
  fileTotalsByAipId: ReadonlyMap<string, number>;
  fallbackTotalsByAipId?: ReadonlyMap<string, number>;
}): Map<string, number> {
  const resolved = new Map<string, number>();
  for (const aipId of input.aipIds) {
    if (!aipId) continue;
    resolved.set(
      aipId,
      resolveAipDisplayTotal({
        aipId,
        fileTotalsByAipId: input.fileTotalsByAipId,
        fallbackTotalsByAipId: input.fallbackTotalsByAipId,
      })
    );
  }
  return resolved;
}

export function sumAipDisplayTotals(input: {
  aipIds: Iterable<string>;
  displayTotalsByAipId: ReadonlyMap<string, number>;
}): number {
  let total = 0;
  for (const aipId of input.aipIds) {
    if (!aipId) continue;
    const amount = input.displayTotalsByAipId.get(aipId);
    if (typeof amount === "number" && Number.isFinite(amount)) {
      total += amount;
    }
  }
  return total;
}

export async function fetchAipFileTotalsByAipIds(
  client: { from: (table: string) => unknown },
  aipIds: string[]
): Promise<Map<string, number>> {
  const normalizedAipIds = dedupeNonEmptyStrings(aipIds);
  const totals = new Map<string, number>();
  if (!normalizedAipIds.length) return totals;

  const rows = await collectInChunks(normalizedAipIds, async (aipIdChunk) => {
    const query = client.from("aip_totals") as AipTotalsQuery;
    const { data, error } = await query
      .select("aip_id,total_investment_program")
      .eq("source_label", "total_investment_program")
      .in("aip_id", aipIdChunk);

    if (error) throw new Error(error.message);
    return (data ?? []) as AipTotalsSelectRow[];
  });

  for (const row of rows) {
    const aipId = typeof row.aip_id === "string" ? row.aip_id : "";
    if (!aipId || totals.has(aipId)) continue;
    const amount = parseAipTotalInvestmentProgram(row.total_investment_program);
    if (amount === null) continue;
    totals.set(aipId, amount);
  }

  return totals;
}
