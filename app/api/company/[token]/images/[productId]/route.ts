import { BUCKET, companyScope } from "@/lib/company-portal";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { IMAGE_TYPES } from "@/lib/supplier-validation";
import { PRIVATE_HEADERS, supplierDenied } from "@/lib/supplier-http";

export const dynamic = "force-dynamic";

// First approved photo of a product, only if Nexo marked the product for this company.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; productId: string }> }) {
  try {
    const { token, productId } = await params;
    if (!UUID_PATTERN.test(productId)) return supplierDenied();
    const { db, link } = await companyScope(token);
    const { data: assigned } = await db.from("sourcing_company_products").select("product_id,sourcing_products!inner(status)")
      .eq("company_id", link.company_id).eq("product_id", productId).eq("sourcing_products.status", "approved").maybeSingle();
    if (!assigned) return supplierDenied();
    const { data: image } = await db.from("sourcing_product_images").select("object_path,mime_type")
      .eq("product_id", productId).eq("ready", true).eq("approved", true).order("created_at").limit(1).maybeSingle();
    if (!image || !(IMAGE_TYPES as readonly string[]).includes(image.mime_type)) return supplierDenied();
    const { data: file, error } = await db.storage.from(BUCKET).download(image.object_path);
    if (error || !file) return supplierDenied();
    return new Response(await file.arrayBuffer(), {
      headers: { ...PRIVATE_HEADERS, "Cache-Control": "private, max-age=300", "Content-Type": image.mime_type, "Content-Disposition": "inline" }
    });
  } catch {
    return supplierDenied();
  }
}
