import type { ReactNode } from "react";
import type { LguVariant } from "@/types/navigation";
import LguSidebar from "@/components/layout/lgu-sidebar";
import LguTopbar from "@/components/layout/lgu-topbar";
import LguFooter from "@/components/layout/lgu-footer";
import SmartLoadingRegion from "@/components/ui/SmartLoadingRegion";
import type { LguAccountProfile } from "@/features/account/types";

type Props = {
  variant: LguVariant;
  children: ReactNode;

  // Replace these with Supabase user data later
  userName?: string;
  roleLabel?: string;
  scopeDisplayName?: string;
  accountProfile: LguAccountProfile;
};

export default function LguShell({
  variant,
  children,
  userName = "Juan Dela Cruz",
  roleLabel = variant === "barangay" ? "Barangay Official" : "City Official",
  scopeDisplayName,
  accountProfile,
}: Props) {
  return (
    <div className="min-h-screen bg-slate-50 flex">
      <LguSidebar variant={variant} scopeDisplayName={scopeDisplayName} />

      <div className="flex-1 min-w-0 flex flex-col">
        <LguTopbar name={userName} roleLabel={roleLabel} accountProfile={accountProfile} />

        <main className="flex flex-1 min-h-0 flex-col px-8 py-6">
          <SmartLoadingRegion id="lgu-main">{children}</SmartLoadingRegion>
        </main>

        <LguFooter />
      </div>
    </div>
  );
}
