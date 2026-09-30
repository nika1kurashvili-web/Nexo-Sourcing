"use server";

import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSourcingAccess } from "@/lib/auth";
import { UUID_PATTERN } from "@/lib/supplier-validation";

export async function createSupplierLink(requestId: string, supplierId: string, days: number) {
  const { supabase, user } = await requireSourcingAccess();
  if (!UUID_PATTERN.test(requestId) || !UUID_PATTERN.test(supplierId) || ![7, 30, 90].includes(days)) {
    return { error: "Invalid share link settings." };
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "Configure SUPABASE_SERVICE_ROLE_KEY on the server before creating supplier links." };
  const { data: assignment, error: assignmentError } = await supabase.from("sourcing_request_items")
    .select("id").eq("request_id", requestId).eq("supplier_id", supplierId).limit(1).maybeSingle();
  if (assignmentError || !assignment) return { error: "This supplier has no assigned items in this request." };
  const now = new Date().toISOString();
  // Expired tokens stay permanently inactive before a replacement is generated.
  const { error: expireError } = await supabase.from("sourcing_supplier_share_links")
    .update({ active: false, revoked_at: now }).eq("request_id", requestId).eq("supplier_id", supplierId)
    .eq("active", true).lte("expires_at", now);
  if (expireError) return { error: "Unable to create link. Check that the supplier portal migration has been applied." };
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const { data, error } = await supabase.from("sourcing_supplier_share_links").insert({
    request_id: requestId, supplier_id: supplierId, token_hash: createHash("sha256").update(token).digest("hex"),
    expires_at: expiresAt, created_by: user.id
  }).select("id").single();
  if (error || !data) return { error: "Unable to create link. Revoke any active link for this supplier first." };
  await supabase.from("sourcing_activity_log").insert({ request_id: requestId, user_id: user.id,
    action: "supplier_link_created", details: `Supplier share link created (expires ${expiresAt}).` });
  revalidatePath(`/requests/${requestId}`);
  return { id: data.id as string, url: `https://sourcing.nexo.ge/supplier/${token}`, expiresAt };
}

export async function revokeSupplierLink(requestId: string, supplierId: string, linkId: string) {
  const { supabase, user } = await requireSourcingAccess();
  if (![requestId, supplierId, linkId].every(id => UUID_PATTERN.test(id))) return { error: "Invalid link." };
  const { data, error } = await supabase.from("sourcing_supplier_share_links")
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq("id", linkId).eq("request_id", requestId).eq("supplier_id", supplierId).eq("active", true)
    .select("id").maybeSingle();
  if (error) return { error: "Unable to revoke link. Please try again." };
  if (data) await supabase.from("sourcing_activity_log").insert({ request_id: requestId, user_id: user.id,
    action: "supplier_link_revoked", details: "Supplier share link revoked." });
  revalidatePath(`/requests/${requestId}`);
  return { ok: true };
}
