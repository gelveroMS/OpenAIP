import "server-only";

type TimingMeta = Record<string, unknown>;

type MeasureTimingInput<T> = {
  label: string;
  run: () => Promise<T>;
  meta?: TimingMeta;
};

export function isCitizenDashboardTimingEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.CITIZEN_DASHBOARD_DEBUG_LOGS === "true"
  );
}

function formatDurationMs(startMs: number): number {
  return Number((performance.now() - startMs).toFixed(2));
}

function logTiming(label: string, durationMs: number, meta?: TimingMeta) {
  if (!isCitizenDashboardTimingEnabled()) return;
  if (meta && Object.keys(meta).length > 0) {
    console.info(`[perf][citizen-dashboard] ${label} ${durationMs}ms`, meta);
    return;
  }
  console.info(`[perf][citizen-dashboard] ${label} ${durationMs}ms`);
}

export async function measureTiming<T>(input: MeasureTimingInput<T>): Promise<T> {
  const startMs = performance.now();
  try {
    const result = await input.run();
    logTiming(input.label, formatDurationMs(startMs), input.meta);
    return result;
  } catch (error) {
    logTiming(input.label, formatDurationMs(startMs), {
      ...(input.meta ?? {}),
      failed: true,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
