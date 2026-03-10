export const SUPABASE_PAGE_SIZE = 1_000;
export const IN_FILTER_CHUNK_SIZE = 200;

function resolvePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

export function dedupeNonEmptyStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      )
    )
  );
}

export function chunkArray<T>(
  values: T[],
  size = IN_FILTER_CHUNK_SIZE
): T[][] {
  if (values.length === 0) return [];
  const chunkSize = resolvePositiveInt(size, IN_FILTER_CHUNK_SIZE);
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function collectPaged<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  options?: { pageSize?: number }
): Promise<T[]> {
  const pageSize = resolvePositiveInt(options?.pageSize, SUPABASE_PAGE_SIZE);
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const batch = await fetchPage(from, to);
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export async function collectInChunks<TValue, TRow>(
  values: TValue[],
  fetchChunk: (chunk: TValue[]) => Promise<TRow[]>,
  options?: { chunkSize?: number }
): Promise<TRow[]> {
  const chunkSize = resolvePositiveInt(options?.chunkSize, IN_FILTER_CHUNK_SIZE);
  const rows: TRow[] = [];

  for (const chunk of chunkArray(values, chunkSize)) {
    const batch = await fetchChunk(chunk);
    rows.push(...batch);
  }

  return rows;
}

export async function collectInChunksPaged<TValue, TRow>(
  values: TValue[],
  fetchPage: (chunk: TValue[], from: number, to: number) => Promise<TRow[]>,
  options?: { chunkSize?: number; pageSize?: number }
): Promise<TRow[]> {
  const chunkSize = resolvePositiveInt(options?.chunkSize, IN_FILTER_CHUNK_SIZE);
  const pageSize = resolvePositiveInt(options?.pageSize, SUPABASE_PAGE_SIZE);
  const rows: TRow[] = [];

  for (const chunk of chunkArray(values, chunkSize)) {
    const chunkRows = await collectPaged(
      (from, to) => fetchPage(chunk, from, to),
      { pageSize }
    );
    rows.push(...chunkRows);
  }

  return rows;
}
