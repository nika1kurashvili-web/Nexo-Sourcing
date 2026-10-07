import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { INVALID_LINK, hashToken } from "@/lib/supplier-portal";
import { TOKEN_PATTERN } from "@/lib/supplier-validation";

// Deliberate projection: the supplier-facing catalog never selects internal_note.
export const CATALOG_PRODUCT_COLUMNS =
  "id,name,description,specifications,price,currency,moq,lead_time_days,box_length_cm,box_width_cm,box_height_cm,weight_kg,status,created_at,updated_at";

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
