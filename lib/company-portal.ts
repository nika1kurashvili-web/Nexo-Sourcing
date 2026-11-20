import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET, hashToken } from "@/lib/supplier-portal";
import { TOKEN_PATTERN } from "@/lib/supplier-validation";

export const INVALID_COMPANY_LINK = "This link is invalid or no longer active.";
export { BUCKET };

// Checks the company link on every request (a revoked link stops working immediately).
export async function companyScope(token: string) {
  if (!TOKEN_PATTERN.test(token)) throw new Error(INVALID_COMPANY_LINK);
  const db: any = createAdminClient();
  const hash = hashToken(token);
  const { data: link, error } = await db.from("sourcing_company_links")
    .select("id,company_id").eq("token_hash", hash).eq("active", true).is("revoked_at", null).maybeSingle();
  if (error || !link) throw new Error(INVALID_COMPANY_LINK);
  return { db, link: link as { id: string; company_id: string }, hash };
}

export type CatalogProduct = {
  id: string; sku: string | null; name: string; description: string | null; specifications: string | null;
  qtyInBox: number | null; price: number | null; currency: string; hasPhoto: boolean;
};

async function companyName(db: any, companyId: string) {
  const { data, error } = await db.from("sourcing_companies").select("name").eq("id", companyId).single();
  if (error || !data) throw new Error(INVALID_COMPANY_LINK);
  return data.name as string;
}

// Deliberate projection: only name, code, description, specifications, box quantity, photo and
// Nexo's sell price. The supplier, the supplier's price and every internal field are never selected.
export async function readCompanyCatalog(token: string) {
  const { db, link } = await companyScope(token);
  const [name, result] = await Promise.all([
    companyName(db, link.company_id),
    db.from("sourcing_company_products")
      .select("product_id,sell_price,currency,sourcing_products!inner(id,sku,name,description,specifications,qty_in_box,status,sourcing_product_images(id,approved,ready))")
      .eq("company_id", link.company_id).eq("sourcing_products.status", "approved").range(0, 999)
  ]);
  if (result.error) throw new Error(INVALID_COMPANY_LINK);
  const products: CatalogProduct[] = ((result.data ?? []) as any[]).map(row => {
    const product = row.sourcing_products;
    const photos: any[] = product.sourcing_product_images ?? [];
    return {
      id: product.id as string, sku: product.sku as string | null, name: product.name as string,
      description: product.description as string | null, specifications: product.specifications as string | null,
      qtyInBox: product.qty_in_box === null || product.qty_in_box === undefined ? null : Number(product.qty_in_box),
      price: row.sell_price === null ? null : Number(row.sell_price), currency: row.currency as string,
      hasPhoto: photos.some(photo => photo.approved && photo.ready)
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  await db.from("sourcing_company_links").update({ last_accessed_at: new Date().toISOString() }).eq("id", link.id).eq("active", true);
  return { companyName: name, products };
}

export async function readCompanyOrders(token: string) {
  const { db, link } = await companyScope(token);
  const payments = ",sourcing_company_payments(id,paid_on,amount,currency,method,note,status,entered_by,created_at)";
  const lines = (prepared: boolean) => `id,order_no,status,note,created_at,sourcing_company_order_items(id,sku,product_name,quantity,unit_price,currency${prepared ? ",prepared_at" : ""})`;
  const query = (columns: string) => db.from("sourcing_company_orders").select(columns)
    .eq("company_id", link.company_id).order("created_at", { ascending: false }).limit(100);
  const name = await companyName(db, link.company_id);
  // Until the payments / ready-mark migrations have been run, the orders still load (just without those parts).
  let result: any = null;
  for (const columns of [lines(true) + payments, lines(false) + payments, lines(true), lines(false)]) {
    result = await query(columns);
    if (!result.error) break;
  }
  if (result.error) throw new Error(INVALID_COMPANY_LINK);
  return { companyName: name, orders: (result.data ?? []) as any[] };
}

export async function readCompanyProposals(token: string) {
  const { db, link } = await companyScope(token);
  const [name, result] = await Promise.all([
    companyName(db, link.company_id),
    db.from("sourcing_company_proposals").select("id,name,status,created_at")
      .eq("company_id", link.company_id).order("created_at", { ascending: false }).limit(50)
  ]);
  if (result.error) throw new Error(INVALID_COMPANY_LINK);
  return { companyName: name, proposals: (result.data ?? []) as { id: string; name: string; status: string; created_at: string }[] };
}
