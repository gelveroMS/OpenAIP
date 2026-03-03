import { notFound } from "next/navigation";
import { AipDetailView } from "@/features/aip";
import { getActorContext } from "@/lib/domain/get-actor-context";
import { getAipRepo } from "@/lib/repos/aip/repo.server";

export default async function BarangayAipDetail({
  params,
}: {
  params: Promise<{ aipId: string }>;
}) {
  const { aipId } = await params;
  const actor = await getActorContext();

  const aipRepo = getAipRepo({ defaultScope: "barangay" });
  const aip = await aipRepo.getAipDetail(aipId, actor ?? undefined);

  if (!aip || aip.scope !== "barangay") return notFound();

  return <AipDetailView aip={aip} scope="barangay" />;
}
