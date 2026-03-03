import AdminShell from "@/components/layout/admin-shell";
import { getUser } from "@/lib/actions/auth.actions";
import { normalizeToDbRole, routeRoleToDbRole } from "@/lib/auth/roles";
import { isTempAdminBypassEnabled } from "@/lib/auth/dev-bypass";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
// Admin layout is auth-cookie dependent and must always render dynamically per request.

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (isTempAdminBypassEnabled()) {
    return (
      <AdminShell
        profileName="Admin User"
        profileRole="System Administration"
        profileEmail="admin@example.com"
      >
        {children}
      </AdminShell>
    );
  }

  const userData = await getUser().catch(() => {
    redirect("/admin/sign-in");
  });

  if (!userData) {
    redirect("/admin/sign-in");
  }

  const normalizedRole = normalizeToDbRole(userData.userRole);
  if (normalizedRole !== routeRoleToDbRole("admin")) {
    redirect("/admin/unauthorized");
  }

  return (
    <AdminShell
      profileName={userData.fullName}
      profileRole={userData.officeLabel}
      profileEmail={userData.email}
    >
      {children}
    </AdminShell>
  );
}
