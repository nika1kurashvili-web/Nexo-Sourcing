import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Server-only service client for the catalog and order tables (closed to browser clients).
// Always call requireSourcingAccess() before using it.
export function adminDb(): any {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Configure SUPABASE_SERVICE_ROLE_KEY on the server to use products and orders.");
  }
  return createAdminClient();
}
