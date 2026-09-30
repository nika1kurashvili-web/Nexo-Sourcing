import { Sidebar } from "@/components/Sidebar";
import { requireSourcingAccess } from "@/lib/auth";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSourcingAccess();
  return (
    <div className="shell">
      <Sidebar email={user.email ?? "User"} />
      <main className="main"><div className="container">{children}</div></main>
    </div>
  );
}
