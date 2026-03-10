"use client";

import { useEffect, useMemo, useRef } from "react";
import type {
  REALTIME_SUBSCRIBE_STATES,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import type { AipHeader } from "@/lib/repos/aip/types";
import { supabaseBrowser } from "@/lib/supabase/client";

type RealtimeRunEventType = "INSERT" | "UPDATE";

export type ExtractionRunRealtimeRow = {
  id: string;
  aip_id: string;
  stage: string | null;
  status: string | null;
  error_message: string | null;
  overall_progress_pct: number | null;
  stage_progress_pct: number | null;
  progress_message: string | null;
  progress_updated_at: string | null;
};

export type ExtractionRunRealtimeEvent = {
  eventType: RealtimeRunEventType;
  run: ExtractionRunRealtimeRow;
};

export type UseExtractionRunsRealtimeInput = {
  enabled?: boolean;
  runId?: string;
  aipId?: string;
  channelKey?: string;
  onRunEvent?: (event: ExtractionRunRealtimeEvent) => void;
  onSubscribeError?: (error: Error | null) => void;
  onStatusChange?: (status: REALTIME_SUBSCRIBE_STATES) => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value;
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function clampProgress(value: number | null | undefined, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeMessage(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const message = value.trim();
  return message.length > 0 ? message : null;
}

function toProcessingStage(value: string | null): NonNullable<AipHeader["processing"]>["stage"] {
  if (value === "scale_amounts") return "validate";
  if (
    value === "extract" ||
    value === "validate" ||
    value === "summarize" ||
    value === "categorize" ||
    value === "embed"
  ) {
    return value;
  }
  return null;
}

export function toExtractionRunRealtimeRow(value: unknown): ExtractionRunRealtimeRow | null {
  const row = asRecord(value);
  if (!row) return null;

  const id = asStringOrNull(row.id);
  const aipId = asStringOrNull(row.aip_id);
  if (!id || !aipId) return null;

  return {
    id,
    aip_id: aipId,
    stage: asStringOrNull(row.stage),
    status: asStringOrNull(row.status),
    error_message: asStringOrNull(row.error_message),
    overall_progress_pct: asNumberOrNull(row.overall_progress_pct),
    stage_progress_pct: asNumberOrNull(row.stage_progress_pct),
    progress_message: asStringOrNull(row.progress_message),
    progress_updated_at: asStringOrNull(row.progress_updated_at),
  };
}

export function mapRealtimePayloadToRunEvent(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>
): ExtractionRunRealtimeEvent | null {
  if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return null;
  const run = toExtractionRunRealtimeRow(payload.new);
  if (!run) return null;

  return {
    eventType: payload.eventType,
    run,
  };
}

export function mapRunToAipCardProcessing(
  run: ExtractionRunRealtimeRow
): AipHeader["processing"] | undefined {
  if (run.status !== "queued" && run.status !== "running") return undefined;

  return {
    state: "processing",
    overallProgressPct: clampProgress(run.overall_progress_pct, 0),
    message: normalizeMessage(run.progress_message),
    runId: run.id,
    stage: toProcessingStage(run.stage),
    status: run.status,
  };
}

export function useExtractionRunsRealtime({
  enabled = true,
  runId,
  aipId,
  channelKey,
  onRunEvent,
  onSubscribeError,
  onStatusChange,
}: UseExtractionRunsRealtimeInput) {
  const onRunEventRef = useRef(onRunEvent);
  const onSubscribeErrorRef = useRef(onSubscribeError);
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    onRunEventRef.current = onRunEvent;
  }, [onRunEvent]);

  useEffect(() => {
    onSubscribeErrorRef.current = onSubscribeError;
  }, [onSubscribeError]);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const filter = useMemo(() => {
    if (runId) return `id=eq.${runId}`;
    if (aipId) return `aip_id=eq.${aipId}`;
    return undefined;
  }, [aipId, runId]);

  const channelName = useMemo(
    () => `aip-extraction-runs:${channelKey ?? filter ?? "all"}`,
    [channelKey, filter]
  );

  useEffect(() => {
    if (!enabled) return;

    const supabase = supabaseBrowser();
    const channel = supabase.channel(channelName);
    const runFilter = filter;
    const postgresFilter = {
      schema: "public" as const,
      table: "extraction_runs",
      ...(runFilter ? { filter: runFilter } : {}),
    };

    const handlePayload = (
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>
    ) => {
      const event = mapRealtimePayloadToRunEvent(payload);
      if (!event) return;
      onRunEventRef.current?.(event);
    };

    channel
      .on(
        "postgres_changes",
        { ...postgresFilter, event: "INSERT" },
        handlePayload
      )
      .on(
        "postgres_changes",
        { ...postgresFilter, event: "UPDATE" },
        handlePayload
      )
      .subscribe((status, error) => {
        onStatusChangeRef.current?.(status);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          onSubscribeErrorRef.current?.(error ?? null);
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelName, enabled, filter]);
}
