/**
 * AIP Management View Component
 * 
 * Main management interface for Annual Investment Plans.
 * Provides filtering, searching, and upload capabilities for AIP documents.
 * Displays a list of AIP records with year-based filtering.
 * 
 * @module feature/aips/aip-management-view
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

import { Plus } from "lucide-react";
import type { AipHeader } from "../types";
import { getAipYears } from "../utils";
import AipCard from "../components/aip-card";
import UploadAipDialog from "../dialogs/upload-aip-dialog";
import { isMockEnabled } from "@/lib/config/appEnv";
import { withCsrfHeader } from "@/lib/security/csrf";
import {
  mapRunToAipCardProcessing,
  useExtractionRunsRealtime,
  type ExtractionRunRealtimeEvent,
} from "../hooks/use-extraction-runs-realtime";

/**
 * Props for AipManagementView component
 */
type Props = {
  /** Array of AIP records to display */
  records: AipHeader[];
  /** Administrative scope for routing */
  scope?: "city" | "barangay";
};

/**
 * AipManagementView Component
 * 
 * Manages the display and organization of AIP documents.
 * Features:
 * - Year-based filtering
 * - Upload new AIP functionality
 * - Displays AIP count
 * - Responsive card-based layout
 * 
 * @param records - Array of AIP records to manage
 * @param scope - Administrative scope (city or barangay)
 */
export default function AipManagementView({ 
  records, 
  scope = "barangay"
}: Props) {
  const router = useRouter();
  const recordsSignature = useMemo(
    () => records.map((record) => record.id).join("|"),
    [records]
  );
  const [processingState, setProcessingState] = useState<{
    signature: string;
    byAipId: Record<string, AipHeader["processing"] | undefined>;
  }>({
    signature: "",
    byAipId: {},
  });
  const processingByAipId = useMemo(
    () =>
      processingState.signature === recordsSignature ? processingState.byAipId : {},
    [processingState, recordsSignature]
  );
  const activeRecords = useMemo(
    () =>
      records.map((record) => {
        if (Object.prototype.hasOwnProperty.call(processingByAipId, record.id)) {
          return {
            ...record,
            processing: processingByAipId[record.id],
          };
        }
        return record;
      }),
    [processingByAipId, records]
  );

  const years = useMemo(() => getAipYears(activeRecords), [activeRecords]);

  const [yearFilter, setYearFilter] = useState<string>("all");
  const [openUpload, setOpenUpload] = useState(false);
  const mockEnabled = isMockEnabled();
  const refreshedTerminalRunIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    refreshedTerminalRunIdsRef.current.clear();
  }, [recordsSignature]);
  const trackedAipIds = useMemo(
    () => new Set(records.map((record) => record.id)),
    [records]
  );

  const handleRunEvent = useCallback(
    ({ run }: ExtractionRunRealtimeEvent) => {
      if (!trackedAipIds.has(run.aip_id)) return;

      setProcessingState((current) => {
        const baseMap =
          current.signature === recordsSignature ? current.byAipId : {};

        return {
          signature: recordsSignature,
          byAipId: {
            ...baseMap,
            [run.aip_id]: mapRunToAipCardProcessing(run),
          },
        };
      });

      if (
        (run.status === "succeeded" || run.status === "failed") &&
        !refreshedTerminalRunIdsRef.current.has(run.id)
      ) {
        refreshedTerminalRunIdsRef.current.add(run.id);
        router.refresh();
      }
    },
    [recordsSignature, router, trackedAipIds]
  );

  useExtractionRunsRealtime({
    enabled: !mockEnabled,
    channelKey: `${scope}-aip-management`,
    onRunEvent: handleRunEvent,
  });

  const filtered = useMemo(() => {
    if (yearFilter === "all") return activeRecords;
    const y = Number(yearFilter);
    return activeRecords.filter((r) => r.year === y);
  }, [activeRecords, yearFilter]);

  const scopeLabel = scope === "city" ? "city" : "barangay";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900">AIP Management</h1>
        <p className="mt-2 text-sm text-slate-600">
          Manage, upload, review, and monitor Annual Investment Plan (AIP) documents for {scopeLabel} development.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-500">Showing {filtered.length} AIPs</div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select value={yearFilter} onValueChange={setYearFilter}>
            <SelectTrigger className="w-[180px] bg-slate-50 border-slate-200">
              <SelectValue placeholder="All Years" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Years</SelectItem>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            className="bg-[#022437] hover:bg-[#022437]/90"
            onClick={() => setOpenUpload(true)}
          >
            <Plus className="h-4 w-4" />
            Upload New AIP
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="space-y-4">
        {filtered.map((aip) => (
          <AipCard key={aip.id} aip={aip} scope={scope} />
        ))}
      </div>

      <UploadAipDialog
        open={openUpload}
        onOpenChange={setOpenUpload}
        scope={scope}
        onSubmit={async ({ file, year }) => {
          if (mockEnabled) {
            throw new Error("Upload requires Supabase mode. Set NEXT_PUBLIC_USE_MOCKS=false.");
          }

          const form = new FormData();
          form.append("file", file);
          form.append("year", String(year));

          const uploadApiPath =
            scope === "city" ? "/api/city/aips/upload" : "/api/barangay/aips/upload";
          const response = await fetch(
            uploadApiPath,
            withCsrfHeader({
              method: "POST",
              body: form,
            })
          );

          const payload = (await response.json()) as
            | {
                ok: true;
                message: string;
                data?: {
                  aipId?: string;
                  runId?: string;
                  status?: string;
                };
              }
            | {
                ok?: false;
                code?: string;
                message?: string;
              };

          if (
            !response.ok ||
            payload.ok !== true ||
            !payload.data?.aipId ||
            !payload.data?.runId ||
            !payload.data?.status
          ) {
            throw new Error(payload.message ?? "Failed to upload AIP.");
          }

          return {
            aipId: payload.data.aipId,
            runId: payload.data.runId,
            status: payload.data.status,
          };
        }}
        onSuccess={({ aipId, runId }) => {
          const scopePath = scope === "city" ? "city" : "barangay";
          router.push(`/${scopePath}/aips/${aipId}?run=${encodeURIComponent(runId)}`);
        }}
      />
    </div>
  );
}
