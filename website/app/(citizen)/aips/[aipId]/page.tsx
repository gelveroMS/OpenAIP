import AipDetailsHeader from '@/features/citizen/aips/components/aip-details-header';
import AipDetailsTabs from '@/features/citizen/aips/components/aip-details-tabs';
import { toAipDetails } from '@/features/citizen/aips/data/aips.data';
import { getCitizenAipRepo } from '@/lib/repos/citizen-aips';
import { notFound } from 'next/navigation';

export const dynamic = "force-dynamic";

const CitizenAipDetailsPage = async ({ params }: { params: Promise<{ aipId: string }> }) => {
  const { aipId } = await params;
  const repo = getCitizenAipRepo();
  const record = await repo.getPublishedAipDetail(aipId);

  if (!record) {
    notFound();
  }

  const aipDetails = toAipDetails(record);

  return (
    <section className="space-y-4 md:space-y-6 overflow-x-hidden">
      <AipDetailsHeader aip={aipDetails} />
      <AipDetailsTabs aip={aipDetails} />
    </section>
  );
};

export default CitizenAipDetailsPage;
