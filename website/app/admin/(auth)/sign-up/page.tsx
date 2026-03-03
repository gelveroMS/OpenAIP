import { redirect } from "next/navigation";

export default function AdminSignUpPage() {
  // Admin accounts are provisioned internally; public admin sign-up remains disabled.
  redirect("/admin/sign-in");
}
