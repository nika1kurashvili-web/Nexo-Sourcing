import { scopedItem, supplierScope } from "@/lib/supplier-portal";
import { supplierBody, supplierDenied, supplierJson } from "@/lib/supplier-http";
import { parseSeenThrough } from "@/lib/item-unread";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, { params }: { params: Promise<{ token: string; itemId: string }> }) {
  const { token, itemId } = await params;
  let scope;
  try { scope = await supplierScope(token); await scopedItem(scope, itemId); }
  catch { return supplierDenied(); }
  let seenThrough;
  try { seenThrough = parseSeenThrough(await supplierBody(request)); }
  catch { return supplierJson({ error: "Invalid seen timestamp." }, 400); }
  // Recheck validity and both assignment predicates inside the transaction.
  const { data, error } = await scope.db.rpc("sourcing_supplier_mutate", {
    p_hash: scope.hash, p_item: itemId, p_operation: "seen", p_payload: { seenThrough }
  });
  if (error) return supplierDenied();
  if (!data?.ok) return supplierJson({ error: "Item has a newer update. Reopen it to mark it seen." }, 409);
  return supplierJson({ ok: true, seenThrough });
}
