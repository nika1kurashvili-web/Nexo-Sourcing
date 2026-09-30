import { logoutAction } from "@/app/actions";
export default function NoAccessPage() {
  return (
    <main className="login-wrap">
      <div className="login-card">
        <h1>წვდომა არ გაქვს</h1>
        <p className="muted">ეს ანგარიში არ არის დამატებული Nexo Sourcing-ის მომხმარებლებში.</p>
        <form action={logoutAction}><button className="btn full" type="submit">გამოსვლა</button></form>
      </div>
    </main>
  );
}
