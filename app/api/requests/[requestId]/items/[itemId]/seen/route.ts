import { requireSourcingAccess } from "@/lib/auth";
import { supplierBody, supplierJson } from "@/lib/supplier-http";
import { parseSeenThrough, timestampMicros } from "@/lib/item-unread";
import { UUID_PATTERN } from "@/lib/supplier-validation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string; itemId: string }> }) {
  let supabase;
  try { ({ supabase } = await requireSourcingAccess()); }
  catch { return supplierJson({ error: "Unauthorized." }, 401); }
  const { requestId, itemId } = await params;
  if (!UUID_PATTERN.test(requestId) || !UUID_PATTERN.test(itemId)) return supplierJson({ error: "Item unavailable." }, 404);
  let seenThrough;
  try { seenThrough = parseSeenThrough(await supplierBody(request)); }
  catch { return supplierJson({ error: "Invalid seen timestamp." }, 400); }
  const { data: item, error } = await supabase.from("sourcing_request_items")
    .select("id,supplier_changed_at,nexo_seen_at").eq("id", itemId).eq("request_id", requestId).maybeSingle();
  if (error || !item) return supplierJson({ error: "Item unavailable." }, 404);
  if (timestampMicros(item.supplier_changed_at) !== timestampMicros(seenThrough)) {
    return supplierJson({ error: "Item has a newer update. Reopen it to mark it seen." }, 409);
  }
  // Compare-and-set the exact client-rendered timestamp, never the latest value
  // from a newer page or the wall clock. The authenticated client preserves RLS.
  const { data: updated, error: updateError } = await supabase.from("sourcing_request_items")
    .update({ nexo_seen_at: seenThrough }).eq("id", itemId).eq("request_id", requestId)
    .eq("supplier_changed_at", seenThrough).select("id").maybeSingle();
  if (updateError) return supplierJson({ error: "Unable to mark item seen." }, 500);
  if (!updated) return supplierJson({ error: "Item has a newer update. Reopen it to mark it seen." }, 409);
  return supplierJson({ ok: true, seenThrough });
}
