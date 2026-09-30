import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { TOKEN_PATTERN, UUID_PATTERN } from "@/lib/supplier-validation";

export const INVALID_LINK = "This supplier link is invalid or no longer active.";
export const BUCKET = "sourcing-files";
// Deliberate projection: never select internal/client fields, even server-side.
export const SUPPLIER_ITEM_COLUMNS = "id,item_no,product_name,quantity,unit,specifications,image_url,china_price,currency,moq,lead_time_days,box_length_cm,box_width_cm,box_height_cm,weight_kg,supplier_comment,supplier_status";
export type SupplierItem = {
  id: string; item_no: number; product_name: string; quantity: number | null; unit: string | null;
  specifications: string | null; image_url: string | null; china_price: number | null; currency: string | null;
  moq: number | null; lead_time_days: number | null; box_length_cm: number | null; box_width_cm: number | null;
  box_height_cm: number | null; weight_kg: number | null; supplier_comment: string | null; supplier_status: string;
};
export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function supplierScope(token: string) {
  if (!TOKEN_PATTERN.test(token)) throw new Error(INVALID_LINK);
  const db = createAdminClient();
  const hash = hashToken(token);
  const { data: link, error } = await db.from("sourcing_supplier_share_links")
    .select("id,request_id,supplier_id,expires_at,created_by")
    .eq("token_hash", hash).eq("active", true).is("revoked_at", null).maybeSingle();
  if (error || !link || (link.expires_at && Date.parse(link.expires_at) <= Date.now())) throw new Error(INVALID_LINK);
  return { db, link, hash };
}
export type SupplierScope = Awaited<ReturnType<typeof supplierScope>>;

export async function scopedItem(scope: SupplierScope, itemId: string) {
  if (!UUID_PATTERN.test(itemId)) throw new Error(INVALID_LINK);
  const { data, error } = await scope.db.from("sourcing_request_items").select(SUPPLIER_ITEM_COLUMNS)
    .eq("id", itemId).eq("request_id", scope.link.request_id).eq("supplier_id", scope.link.supplier_id).maybeSingle();
  if (error || !data) throw new Error(INVALID_LINK);
  return data as SupplierItem;
}

export async function readSupplierPortal(token: string) {
  const scope = await supplierScope(token);
  const { db, link } = scope;
  const { data, error } = await db.from("sourcing_request_items").select(SUPPLIER_ITEM_COLUMNS)
    .eq("request_id", link.request_id).eq("supplier_id", link.supplier_id).order("item_no");
  if (error) throw new Error(INVALID_LINK);
  const items = (data ?? []) as SupplierItem[];
  if (!items.length) return { items: [], images: [], requestNo: null, supplierName: null };
  const [request, supplier, images] = await Promise.all([
    db.from("sourcing_requests")
  .select("request_no,created_at,deadline_at")
  .eq("id", link.request_id)
  .single(),
    db.from("sourcing_suppliers").select("name").eq("id", link.supplier_id).single(),
    db.from("sourcing_supplier_images").select("id,request_item_id")
      .eq("request_id", link.request_id).eq("supplier_id", link.supplier_id).eq("ready", true)
      .in("request_item_id", items.map(item => item.id))
  ]);
  if (request.error || supplier.error || images.error) throw new Error(INVALID_LINK);
  // Recheck after reads; responses and image routes are never cached.
  await supplierScope(token);
  await db.from("sourcing_supplier_share_links").update({ last_accessed_at: new Date().toISOString() }).eq("id", link.id).eq("active", true);
  return {
  items,
  images: images.data ?? [],
  requestNo: request.data.request_no as string,
  supplierName: supplier.data.name as string,
  createdAt: request.data.created_at as string,
  deadlineAt: request.data.deadline_at as string | null,
};
}
