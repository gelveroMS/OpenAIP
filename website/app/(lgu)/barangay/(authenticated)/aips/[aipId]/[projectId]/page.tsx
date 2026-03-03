import { notFound } from "next/navigation";
import { AipProjectDetailView } from "@/features/aip";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { getAipProjectRepo, getAipRepo } from "@/lib/repos/aip/repo.server";

export default async function BarangayAipProjectReviewPage({
  params,
}: {
  params: Promise<{ aipId: string; projectId: string }>;
}) {
  const { aipId, projectId } = await params;
  const actor = await getActorContext();
  const aipRepo = getAipRepo({ defaultScope: "barangay" });
  const projectRepo = getAipProjectRepo("barangay");

  const [aip, detail] = await Promise.all([
    aipRepo.getAipDetail(aipId, actor ?? undefined),
    projectRepo.getReviewDetail(aipId, projectId),
  ]);

  if (!aip || aip.scope !== "barangay" || !detail || detail.project.aipId !== aipId) {
    return notFound();
  }

  const forceReadOnly =
    aip.workflowPermissions?.canManageBarangayWorkflow === false;

  return (
    <AipProjectDetailView
      scope="barangay"
      aip={aip}
      detail={detail}
      forceReadOnly={forceReadOnly}
      readOnlyMessage={
        aip.workflowPermissions?.lockReason ??
        "Only the uploader of this AIP can modify this workflow."
      }
    />
  );
}
