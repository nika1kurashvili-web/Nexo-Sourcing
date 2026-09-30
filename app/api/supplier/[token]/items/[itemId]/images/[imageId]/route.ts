import { BUCKET, scopedItem, supplierScope } from "@/lib/supplier-portal";
import { MAX_IMAGE_BYTES, UUID_PATTERN, imageMime } from "@/lib/supplier-validation";
import { PRIVATE_HEADERS, supplierDenied } from "@/lib/supplier-http";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; itemId: string; imageId: string }> }) {
  try {
    const { token, itemId, imageId } = await params;
    const scope = await supplierScope(token);
    const item = await scopedItem(scope, itemId);
    let path = item.image_url;
    if (imageId !== "reference") {
      if (!UUID_PATTERN.test(imageId)) return supplierDenied();
      const { data, error } = await scope.db.from("sourcing_supplier_images").select("object_path")
        .eq("id", imageId).eq("request_item_id", itemId).eq("request_id", scope.link.request_id)
        .eq("supplier_id", scope.link.supplier_id).eq("ready", true).maybeSingle();
      if (error || !data) return supplierDenied();
      path = data.object_path;
    }
    // The caller supplies an image ID, never a storage path or arbitrary fetch URL.
    if (!path || !path.startsWith(`requests/${scope.link.request_id}/`) || path.includes("..")) return supplierDenied();
    const { data: signed, error } = await scope.db.storage.from(BUCKET).createSignedUrl(path, 15);
    if (error || !signed) return supplierDenied();
    const download = await fetch(signed.signedUrl, { cache: "no-store", redirect: "error" });
    if (!download.ok) return supplierDenied();
    const file = await download.blob();
    if (file.size > MAX_IMAGE_BYTES) return supplierDenied();
    const mime = imageMime(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    if (!mime) return supplierDenied();
    const latest = await supplierScope(token);
    const currentItem = await scopedItem(latest, itemId);
    if (imageId === "reference" && currentItem.image_url !== path) return supplierDenied();
    // Stream through this authorized endpoint. No reusable download URL escapes
    // to the supplier, so revocation/reassignment blocks subsequent image reads.
    return new Response(file.stream(), { headers: { ...PRIVATE_HEADERS, "Content-Type": mime, "Content-Disposition": "inline" } });
  } catch { return supplierDenied(); }
}
