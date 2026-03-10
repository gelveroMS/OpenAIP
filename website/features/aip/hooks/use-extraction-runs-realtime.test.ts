import { describe, expect, it } from "vitest";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import {
  mapRealtimePayloadToRunEvent,
  mapRunToAipCardProcessing,
} from "./use-extraction-runs-realtime";

function buildPayload(
  eventType: "INSERT" | "UPDATE" | "DELETE",
  row: Record<string, unknown>
): RealtimePostgresChangesPayload<Record<string, unknown>> {
  return {
    eventType,
    schema: "public",
    table: "extraction_runs",
    commit_timestamp: "2026-02-21T00:00:00.000Z",
    errors: [],
    new: eventType === "DELETE" ? {} : row,
    old: eventType === "DELETE" ? row : {},
  } as RealtimePostgresChangesPayload<Record<string, unknown>>;
}

describe("use-extraction-runs-realtime helpers", () => {
  it("maps INSERT payloads into normalized run events", () => {
    const payload = buildPayload("INSERT", {
      id: "run-001",
      aip_id: "aip-001",
      stage: "extract",
      status: "running",
      overall_progress_pct: 25,
      stage_progress_pct: 50,
      progress_message: "Extracting page 1/2...",
      error_message: null,
      progress_updated_at: "2026-02-21T00:01:00.000Z",
    });

    const result = mapRealtimePayloadToRunEvent(payload);
    expect(result).toEqual({
      eventType: "INSERT",
      run: {
        id: "run-001",
        aip_id: "aip-001",
        stage: "extract",
        status: "running",
        error_message: null,
        overall_progress_pct: 25,
        stage_progress_pct: 50,
        progress_message: "Extracting page 1/2...",
        progress_updated_at: "2026-02-21T00:01:00.000Z",
      },
    });
  });

  it("ignores unsupported realtime payloads", () => {
    const deletedPayload = buildPayload("DELETE", {
      id: "run-002",
      aip_id: "aip-001",
    });
    expect(mapRealtimePayloadToRunEvent(deletedPayload)).toBeNull();

    const invalidPayload = buildPayload("UPDATE", {
      aip_id: "aip-001",
    });
    expect(mapRealtimePayloadToRunEvent(invalidPayload)).toBeNull();
  });

  it("maps queued and running statuses to card processing state", () => {
    expect(
      mapRunToAipCardProcessing({
        id: "run-003",
        aip_id: "aip-001",
        stage: "extract",
        status: "queued",
        error_message: null,
        overall_progress_pct: null,
        stage_progress_pct: null,
        progress_message: null,
        progress_updated_at: null,
      })
    ).toEqual({
      state: "processing",
      overallProgressPct: 0,
      message: null,
      runId: "run-003",
      stage: "extract",
      status: "queued",
    });

    expect(
      mapRunToAipCardProcessing({
        id: "run-004",
        aip_id: "aip-001",
        stage: "validate",
        status: "running",
        error_message: null,
        overall_progress_pct: 135,
        stage_progress_pct: 60,
        progress_message: "  validating...  ",
        progress_updated_at: null,
      })
    ).toEqual({
      state: "processing",
      overallProgressPct: 100,
      message: "validating...",
      runId: "run-004",
      stage: "validate",
      status: "running",
    });

    expect(
      mapRunToAipCardProcessing({
        id: "run-007",
        aip_id: "aip-001",
        stage: "scale_amounts",
        status: "running",
        error_message: null,
        overall_progress_pct: 72,
        stage_progress_pct: 50,
        progress_message: "Scaling city monetary fields by 1000...",
        progress_updated_at: null,
      })
    ).toEqual({
      state: "processing",
      overallProgressPct: 72,
      message: "Scaling city monetary fields by 1000...",
      runId: "run-007",
      stage: "validate",
      status: "running",
    });
  });

  it("does not map terminal statuses to card processing state", () => {
    expect(
      mapRunToAipCardProcessing({
        id: "run-005",
        aip_id: "aip-001",
        stage: "categorize",
        status: "succeeded",
        error_message: null,
        overall_progress_pct: 100,
        stage_progress_pct: 100,
        progress_message: null,
        progress_updated_at: null,
      })
    ).toBeUndefined();

    expect(
      mapRunToAipCardProcessing({
        id: "run-006",
        aip_id: "aip-001",
        stage: "validate",
        status: "failed",
        error_message: "Validation failed",
        overall_progress_pct: 50,
        stage_progress_pct: 50,
        progress_message: "Validation failed",
        progress_updated_at: null,
      })
    ).toBeUndefined();
  });
});
