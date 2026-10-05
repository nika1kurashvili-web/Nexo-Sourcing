import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Wrapped in React's cache(): the layout, the page, nested components and server
// actions all call this during one request. Without it every call repeats the
// Supabase Auth round trip plus the sourcing_users query.
export const requireSourcingAccess = cache(async () => {
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
});
