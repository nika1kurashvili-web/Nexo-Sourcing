import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Wrapped in React's cache(): the layout, the page, nested components and server
// actions all call this during one request. Without it every call repeats the
// Supabase Auth round trip plus the sourcing_users query.
export const requireSourcingAccess = cache(async () => {
  const supabase = await createClient();
  // getClaims verifies the signed session token locally (fast) instead of calling Supabase Auth on every page.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims as { sub?: string; email?: string } | undefined;
  if (!claims?.sub) redirect("/login");
  const user = { id: claims.sub as string, email: (claims.email ?? null) as string | null };

  const { data: profile } = await supabase
    .from("sourcing_users")
    .select("user_id, role, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!profile) redirect("/no-access");
  return { supabase, user, profile };
});
