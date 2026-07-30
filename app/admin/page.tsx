import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/auth";
import { usingPostgres } from "@/lib/store";
import AdminDashboard from "@/components/AdminDashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");

  // Memory mode is a fully working demo — services, case studies, and settings
  // all persist for the life of the running server. Leads and analytics need
  // Postgres, so the dashboard hides those panels when it's absent.
  return <AdminDashboard email={admin.email} hasDatabase={usingPostgres} />;
}
