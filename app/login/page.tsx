import { loginAction } from "@/app/actions";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    const { data: access } = await supabase.from("sourcing_users").select("user_id").eq("user_id", data.user.id).eq("active", true).maybeSingle();
    if (access) redirect("/dashboard");
  }
  const message = params.error === "no-access"
    ? "ამ მომხმარებელს Sourcing-ზე წვდომა არ აქვს."
    : params.error ? "Email ან პაროლი არასწორია." : null;

  return (
    <main className="login-wrap">
      <div className="login-card">
        <h1>Nexo Sourcing</h1>
        <p className="muted">მოთხოვნებისა და ჩინეთის პასუხების მართვა</p>
        {message && <div className="notice">{message}</div>}
        <form action={loginAction} className="form-grid">
          <label>Email<input name="email" type="email" required autoComplete="email" /></label>
          <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
          <button className="btn full" type="submit">შესვლა</button>
        </form>
      </div>
    </main>
  );
}
