import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireSourcingAccess() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("sourcing_users")
    .select("user_id, role, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!profile) redirect("/no-access");
  return { supabase, user, profile };
}
