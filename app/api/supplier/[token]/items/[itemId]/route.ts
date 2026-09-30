import { randomUUID } from "node:crypto";
import { BUCKET, scopedItem, supplierScope } from "@/lib/supplier-portal";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, UUID_PATTERN, imageMime, parseSupplierResponse } from "@/lib/supplier-validation";
import { supplierBody, supplierDenied, supplierJson } from "@/lib/supplier-http";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ token: string; itemId: string }> }) {
  const { token, itemId } = await params;
  let scope;
  try { scope = await supplierScope(token); await scopedItem(scope, itemId); }
  catch { return supplierDenied(); }
  let body;
  try { body = await supplierBody(request); }
  catch { return supplierJson({ error: "Invalid request or response too large." }, 400); }
  const { db, link, hash } = scope;
  try {
    if (body.operation === "response") {
      if (Object.keys(body).some(key => !["operation", "response"].includes(key))) return supplierJson({ error: "Invalid response fields." }, 400);
      let response;
      try { response = parseSupplierResponse(body.response); }
      catch (error) { return supplierJson({ error: (error as Error).message }, 400); }
      const { error } = await db.rpc("sourcing_supplier_mutate", { p_hash: hash, p_item: itemId, p_operation: "response", p_payload: response });
      if (error) return supplierDenied();
      revalidatePath(`/requests/${link.request_id}`);
      revalidatePath("/dashboard");
      return supplierJson({ ok: true });
    }
    if (body.operation === "prepare_image") {
      if (Object.keys(body).some(key => !["operation", "mime", "size"].includes(key)) ||
        !(IMAGE_TYPES as readonly unknown[]).includes(body.mime) || typeof body.size !== "number" ||
        !Number.isInteger(body.size) || body.size <= 0 || body.size > MAX_IMAGE_BYTES) {
        return supplierJson({ error: "Choose a JPEG, PNG, WebP, or GIF image up to 10 MB." }, 400);
      }
      const { data, error } = await db.rpc("sourcing_supplier_mutate", {
        p_hash: hash, p_item: itemId, p_operation: "prepare_image",
        p_payload: { id: randomUUID(), mime_type: body.mime, byte_size: body.size }
      });
      if (error || !data) return supplierJson({ error: "Unable to start upload. The link may be inactive or the 20-image limit reached." }, 400);
      const { data: signed, error: signedError } = await db.storage.from(BUCKET).createSignedUploadUrl(data.path, { upsert: false });
      if (signedError || !signed) return supplierJson({ error: "Unable to start image upload. Please try again." }, 400);
      // This capability can only write this random object; it cannot read/list files.
      return supplierJson({ id: data.id, path: data.path, uploadToken: signed.token });
    }
    if (body.operation === "finish_image") {
      if (Object.keys(body).some(key => !["operation", "imageId"].includes(key)) || typeof body.imageId !== "string" || !UUID_PATTERN.test(body.imageId)) return supplierDenied();
      const { data: image, error } = await db.from("sourcing_supplier_images")
        .select("id,object_path,mime_type,byte_size,ready")
        .eq("id", body.imageId).eq("request_item_id", itemId).eq("request_id", link.request_id)
        .eq("supplier_id", link.supplier_id).eq("share_link_id", link.id).maybeSingle();
      if (error || !image) return supplierDenied();
      if (image.ready) return supplierJson({ ok: true });
      const { data: file, error: fileError } = await db.storage.from(BUCKET).download(image.object_path);
      if (fileError || !file) return supplierJson({ error: "Image upload is incomplete. Please try again." }, 400);
      const mime = imageMime(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
      if (file.size !== image.byte_size || file.size > MAX_IMAGE_BYTES || mime !== image.mime_type) {
        await db.storage.from(BUCKET).remove([image.object_path]);
        return supplierJson({ error: "The uploaded file is not a supported image or exceeds the size limit." }, 400);
      }
      const { error: finishError } = await db.rpc("sourcing_supplier_mutate", {
        p_hash: hash, p_item: itemId, p_operation: "finish_image", p_payload: { id: image.id }
      });
      if (finishError) return supplierDenied();
      revalidatePath(`/requests/${link.request_id}`);
      return supplierJson({ ok: true });
    }
    return supplierJson({ error: "Invalid operation." }, 400);
  } catch { return supplierJson({ error: "Unable to save. Please try again." }, 400); }
}
