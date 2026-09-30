import { logoutAction } from "@/app/actions";
export default function NoAccessPage() {
  return (
    <main className="login-wrap">
      <div className="login-card">
        <h1>Access Denied</h1>
        <p className="muted">This account does not have access to Nexo Sourcing.</p>
        <form action={logoutAction}><button className="btn full" type="submit">Sign Out</button></form>
      </div>
    </main>
  );
}
