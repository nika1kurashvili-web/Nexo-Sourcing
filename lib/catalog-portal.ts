import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { INVALID_LINK, hashToken } from "@/lib/supplier-portal";
import { TOKEN_PATTERN } from "@/lib/supplier-validation";

// Deliberate projection: the supplier-facing catalog never selects internal_note.
export const CATALOG_PRODUCT_COLUMNS =
  "id,sku,name,description,specifications,price,currency,moq,lead_time_days,box_length_cm,box_width_cm,box_height_cm,weight_kg,qty_in_box,status,created_at,updated_at";

export async function catalogScope(token: string) {
  if (!TOKEN_PATTERN.test(token)) throw new Error(INVALID_LINK);
  const db: any = createAdminClient();
  const hash = hashToken(token);
  const { data: link, error } = await db.from("sourcing_catalog_links")
    .select("id,supplier_id").eq("token_hash", hash).eq("active", true).is("revoked_at", null).maybeSingle();
  if (error || !link) throw new Error(INVALID_LINK);
  return { db, link: link as { id: string; supplier_id: string }, hash };
}

export type CatalogScope = Awaited<ReturnType<typeof catalogScope>>;

export async function readCatalog(token: string) {
  const { db, link } = await catalogScope(token);
  const [supplier, products] = await Promise.all([
    db.from("sourcing_suppliers").select("name").eq("id", link.supplier_id).single(),
    db.from("sourcing_products").select(CATALOG_PRODUCT_COLUMNS).eq("supplier_id", link.supplier_id).order("created_at", { ascending: false })
  ]);
  if (supplier.error || products.error) throw new Error(INVALID_LINK);
  const rows = (products.data ?? []) as any[];
  const ids = rows.map(product => product.id as string);

  let images: any[] = [];
  let changes: any[] = [];
  if (ids.length) {
    const [imageResult, changeResult] = await Promise.all([
      db.from("sourcing_product_images").select("id,product_id,approved").eq("supplier_id", link.supplier_id)
        .eq("ready", true).in("product_id", ids).order("created_at", { ascending: true }),
      db.from("sourcing_product_changes").select("product_id,kind,payload,created_at")
        .eq("supplier_id", link.supplier_id).eq("status", "pending").in("product_id", ids)
    ]);
    if (imageResult.error || changeResult.error) throw new Error(INVALID_LINK);
    images = imageResult.data ?? [];
    changes = changeResult.data ?? [];
  }

  await db.from("sourcing_catalog_links").update({ last_accessed_at: new Date().toISOString() })
    .eq("id", link.id).eq("active", true);

  return {
    supplierName: supplier.data.name as string,
    products: rows.map(product => ({
      ...product,
      images: images.filter(image => image.product_id === product.id).map(image => ({ id: image.id as string, approved: !!image.approved })),
      change: changes.find(change => change.product_id === product.id) ?? null
    }))
  };
}

// Orders the supplier may see: only "sent" and "confirmed" ones, never payments or internal notes.
export async function readSupplierOrders(token: string) {
  const { db, link } = await catalogScope(token);
  const [supplier, orders] = await Promise.all([
    db.from("sourcing_suppliers").select("name").eq("id", link.supplier_id).single(),
    db.from("sourcing_orders").select("id,order_no,currency,status,sent_at,confirmed_at")
      .eq("supplier_id", link.supplier_id).in("status", ["sent", "confirmed"]).order("created_at", { ascending: false }).limit(100)
  ]);
  if (supplier.error || orders.error) throw new Error(INVALID_LINK);
  const rows = (orders.data ?? []) as any[];
  let items: any[] = [];
  if (rows.length) {
    const result = await db.from("sourcing_order_items").select("id,order_id,sku,product_name,quantity,unit_price,proposed_price,prepared_at")
      .in("order_id", rows.map(order => order.id)).order("created_at");
    if (result.error) throw new Error(INVALID_LINK);
    items = result.data ?? [];
  }
  return {
    supplierName: supplier.data.name as string,
    orders: rows.map(order => ({
      ...order,
      items: items.filter(item => item.order_id === order.id).map(item => ({
        id: item.id as string, sku: item.sku as string | null, name: item.product_name as string,
        quantity: Number(item.quantity),
        price: item.unit_price === null ? null : Number(item.unit_price),
        proposed: item.proposed_price === null ? null : Number(item.proposed_price),
        prepared: item.prepared_at !== null
      }))
    })) as {
      id: string; order_no: string; currency: string; status: "sent" | "confirmed";
      items: { id: string; sku: string | null; name: string; quantity: number; price: number | null; proposed: number | null; prepared: boolean }[];
    }[]
  };
}
