import { writeWorkflowActivityLog } from "@/lib/audit/activity-log";
import { processScopedAipUpload } from "@/lib/upload-gating/server-upload";

export async function POST(request: Request) {
  return processScopedAipUpload(request, {
    scope: "barangay",
    onSuccess: async ({
      aipId,
      fiscalYear,
      hadExistingAip,
      aipStatus,
      fileName,
      scopeId,
    }) => {
      try {
        if (hadExistingAip) {
          await writeWorkflowActivityLog({
            action: "revision_uploaded",
            entityTable: "aips",
            entityId: aipId,
            scope: { barangayId: scopeId },
            metadata: {
              details: `Uploaded a revised AIP PDF for fiscal year ${fiscalYear}.`,
              aip_status: aipStatus,
              fiscal_year: fiscalYear,
              file_name: fileName,
            },
          });
          return;
        }

        await writeWorkflowActivityLog({
          action: "draft_created",
          entityTable: "aips",
          entityId: aipId,
          scope: { barangayId: scopeId },
          hideCrudAction: "aip_created",
          metadata: {
            details: `Created a new AIP draft for fiscal year ${fiscalYear} and uploaded the first PDF.`,
            aip_status: aipStatus,
            fiscal_year: fiscalYear,
            file_name: fileName,
          },
        });
      } catch (error) {
        console.error("[AIP_UPLOAD][WORKFLOW_ACTIVITY_LOG_FAILED]", {
          aipId,
          fiscalYear,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}
