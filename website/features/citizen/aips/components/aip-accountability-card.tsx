import type { ReactNode } from "react";
import { UserCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AipAccountability } from "@/features/citizen/aips/types";

type Props = {
  accountability: AipAccountability;
};

const RowLabel = ({ children }: { children: string }) => (
  <p className="text-sm font-semibold text-slate-800">{children}</p>
);

const MutedRow = ({ children }: { children: ReactNode }) => (
  <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">{children}</div>
);

function formatAccountabilityDate(value: string | null): string {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "N/A";
  return parsed.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Manila",
  });
}

const PersonRow = ({
  label,
  person,
}: {
  label: string;
  person?: { name: string; roleLabel?: string } | null;
}) => (
  <div className="space-y-3">
    <RowLabel>{label}</RowLabel>
    <MutedRow>
      <UserCircle className="mt-1 h-6 w-6 text-slate-500" />
      {person ? (
        <div className="space-y-1 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">{person.name}</p>
          {person.roleLabel && <p>{person.roleLabel}</p>}
        </div>
      ) : (
        <p className="text-sm text-slate-500">N/A</p>
      )}
    </MutedRow>
  </div>
);

export default function AipAccountabilityCard({ accountability }: Props) {
  return (
    <Card className="border-slate-200">
      <CardHeader className="px-4 pb-3 pt-4 sm:px-6 sm:pb-4 sm:pt-6">
        <CardTitle className="text-2xl text-slate-900 sm:text-3xl">Accountability Information</CardTitle>
        <CardDescription className="text-sm sm:text-base">
          Officials responsible for this AIP submission and approval
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5 px-4 pb-4 sm:space-y-6 sm:px-6 sm:pb-6">
        <div className="space-y-6 divide-y divide-slate-200">
          <div className="space-y-6 pb-6">
            <PersonRow label="Uploaded by:" person={accountability.uploadedBy ?? null} />
          </div>
          <div className="space-y-6 pt-6">
            <PersonRow label="Approved by:" person={accountability.approvedBy ?? null} />
          </div>
        </div>

        <div className="grid gap-4 text-sm text-slate-700 md:grid-cols-2">
          <div>
            <RowLabel>Upload Date</RowLabel>
            <p className="mt-1">{formatAccountabilityDate(accountability.uploadDate)}</p>
          </div>
          <div>
            <RowLabel>Approval Date</RowLabel>
            <p className="mt-1">{formatAccountabilityDate(accountability.approvalDate)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
