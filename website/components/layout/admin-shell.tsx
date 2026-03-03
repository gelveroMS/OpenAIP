import type { ReactNode } from "react";
import AdminSidebar from "@/components/layout/admin-sidebar";
import AdminTopbar from "@/components/layout/admin-topbar";
import SmartLoadingRegion from "@/components/ui/SmartLoadingRegion";

type Props = {
  children: ReactNode;
  profileName?: string;
  profileRole?: string;
  profileEmail?: string;
};

export default function AdminShell({
  children,
  profileName = "Admin User",
  profileRole = "System Administration",
  profileEmail = "admin@example.com",
}: Props) {
  return (
    <div className="min-h-screen bg-[#F3F5F7] flex">
      <AdminSidebar />

      <div className="flex-1 min-w-0 flex flex-col">
        <AdminTopbar
          name={profileName}
          roleLabel={profileRole}
          accountProfile={{
            fullName: profileName,
            email: profileEmail,
            role: "admin",
          }}
        />
        <main className="flex flex-1 min-h-0 flex-col px-8 py-6">
          <SmartLoadingRegion id="admin-main">{children}</SmartLoadingRegion>
        </main>
      </div>
    </div>
  );
}

