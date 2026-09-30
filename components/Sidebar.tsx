import Link from "next/link";
import { logoutAction } from "@/app/actions";

export function Sidebar({ email }: { email: string }) {
  return (
    <aside className="sidebar">
      <div className="brand">Nexo Sourcing<small>Simple sourcing CRM</small></div>
      <nav className="nav">
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/requests">Requests</Link>
        <Link href="/companies">Companies</Link>
        <Link href="/suppliers">Suppliers</Link>
      </nav>
      <div className="sidebar-bottom">
        <div className="user-email">{email}</div>
        <form action={logoutAction}><button className="btn secondary full" type="submit">გამოსვლა</button></form>
      </div>
    </aside>
  );
}
