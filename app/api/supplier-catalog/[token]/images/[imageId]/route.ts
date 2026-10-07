import { catalogScope } from "@/lib/catalog-portal";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { BUCKET } from "@/lib/supplier-portal";
import { IMAGE_TYPES } from "@/lib/supplier-validation";
import { PRIVATE_HEADERS, supplierDenied } from "@/lib/supplier-http";

export const dynamic = "force-dynamic";

// Streams a product photo after re-checking the link and the supplier scope on every request.
// Signed Storage URLs are never exposed to the supplier.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; imageId: string }> }) {
  try {
    const { token, imageId } = await params;
    if (!UUID_PATTERN.test(imageId)) return supplierDenied();
    const { db, link } = await catalogScope(token);
    const { data: image, error } = await db.from("sourcing_product_images").select("object_path,mime_type")
      .eq("id", imageId).eq("supplier_id", link.supplier_id).eq("ready", true).maybeSingle();
    if (error || !image || !(IMAGE_TYPES as readonly string[]).includes(image.mime_type)) return supplierDenied();
    const { data: file, error: downloadError } = await db.storage.from(BUCKET).download(image.object_path);
    if (downloadError || !file) return supplierDenied();
    return new Response(await file.arrayBuffer(), {
      headers: { ...PRIVATE_HEADERS, "Content-Type": image.mime_type, "Content-Disposition": "inline" }
    });
  } catch {
    return supplierDenied();
  }
}
