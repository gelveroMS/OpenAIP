import { notFound } from "next/navigation";
import AdminAipMonitoringDetailView from "@/features/admin/aip-monitoring/views/admin-aip-monitoring-detail-view";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { getAipRepo } from "@/lib/repos/aip/repo.server";
import { getAipSubmissionsReviewRepo } from "@/lib/repos/submissions/repo.server";

export default async function AdminAipMonitoringDetailPage({
  params,
}: {
  params: Promise<{ aipId: string }>;
}) {
  const { aipId } = await params;
  const actor = await getActorContext();

  if (!actor || actor.role !== "admin") {
    return notFound();
  }

  const aipRepo = getAipRepo();
  const aip = await aipRepo.getAipDetail(aipId, actor);
  if (!aip) return notFound();

  const reviewRepo = getAipSubmissionsReviewRepo();
  const latestReview = await reviewRepo.getLatestReview({ aipId });

  return <AdminAipMonitoringDetailView aip={aip} latestReview={latestReview} />;
}
