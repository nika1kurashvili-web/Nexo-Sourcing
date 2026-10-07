import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { catalogScope } from "@/lib/catalog-portal";
import { UUID_PATTERN, parseProductFields } from "@/lib/catalog-validation";
import { removeStoragePaths, signedUploadToken, verifyUploadedImage } from "@/lib/catalog-images";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/supplier-validation";
import { supplierBody, supplierDenied, supplierJson } from "@/lib/supplier-http";

export const dynamic = "force-dynamic";

// Used by the portal page to notice a revoked link (404) without reloading.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try { await catalogScope((await params).token); return supplierJson({ active: true }); }
  catch { return supplierDenied(); }
}

function failure(error: { message?: string } | null | undefined, fallback: string) {
  const text = String(error?.message ?? "");
  if (text.includes("Invalid supplier access")) return supplierDenied();
  if (text.includes("Too many products")) return supplierJson({ error: "Too many products are waiting for Nexo's approval. Please wait for them to be reviewed." }, 400);
  if (text.includes("Image limit")) return supplierJson({ error: "A product can have at most 10 photos." }, 400);
  if (text.includes("Photos can only")) return supplierJson({ error: "Photos can only be added to a new product or together with an edit request. Send an edit request first." }, 400);
  return supplierJson({ error: fallback }, 400);
}

// Suppliers can create products (pending until Nexo approves) and send edit/delete REQUESTS.
// No operation here changes or removes an approved product directly.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let scope;
  try { scope = await catalogScope(token); } catch { return supplierDenied(); }
  let body: Record<string, unknown>;
  try { body = await supplierBody(request, 80000); }
  catch { return supplierJson({ error: "Invalid request or response too large." }, 400); }
  const { db, link, hash } = scope;
  const only = (...keys: string[]) => Object.keys(body).every(key => keys.includes(key));
  const productId = typeof body.productId === "string" && UUID_PATTERN.test(body.productId) ? body.productId : null;
  const mutate = (operation: string, payload: Record<string, unknown>) =>
    db.rpc("sourcing_catalog_mutate", { p_hash: hash, p_operation: operation, p_payload: payload });

  try {
    if (body.operation === "create_product") {
      if (!only("operation", "product")) return supplierJson({ error: "Invalid request." }, 400);
      let product;
      try { product = parseProductFields(body.product); }
      catch (error) { return supplierJson({ error: (error as Error).message }, 400); }
      const { data, error } = await mutate("create_product", product);
      if (error || !data) return failure(error, "Unable to save the product.");
      revalidatePath("/products");
      return supplierJson({ ok: true, id: data.id });
    }

    if (body.operation === "request_edit") {
      if (!only("operation", "productId", "product") || !productId) return supplierDenied();
      let product;
      try { product = parseProductFields(body.product); }
      catch (error) { return supplierJson({ error: (error as Error).message }, 400); }
      const { error } = await mutate("request_edit", { product_id: productId, fields: product });
      if (error) return failure(error, "Unable to send the edit request.");
      revalidatePath("/products");
      return supplierJson({ ok: true });
    }

    if (body.operation === "request_delete" || body.operation === "cancel_change") {
      if (!only("operation", "productId") || !productId) return supplierDenied();
      const { data, error } = await mutate(String(body.operation), { product_id: productId });
      if (error) return failure(error, "Unable to send the request.");
      if (body.operation === "cancel_change") await removeStoragePaths(db, data?.removed_paths);
      revalidatePath("/products");
      return supplierJson({ ok: true });
    }

    if (body.operation === "prepare_image") {
      if (!only("operation", "productId", "mime", "size") || !productId
        || !(IMAGE_TYPES as readonly unknown[]).includes(body.mime) || typeof body.size !== "number"
        || !Number.isInteger(body.size) || body.size <= 0 || body.size > MAX_IMAGE_BYTES) {
        return supplierJson({ error: "Choose a JPEG, PNG, WebP, or GIF image up to 10 MB." }, 400);
      }
      const { data, error } = await mutate("prepare_image", {
        product_id: productId, id: randomUUID(), mime_type: body.mime, byte_size: body.size
      });
      if (error || !data) return failure(error, "Unable to start the upload.");
      // This capability can only write this one random object; it cannot read or list files.
      const uploadToken = await signedUploadToken(db, data.path);
      if (!uploadToken) return supplierJson({ error: "Unable to start the upload. Please try again." }, 400);
      return supplierJson({ id: data.id, path: data.path, uploadToken });
    }

    if (body.operation === "finish_image") {
      if (!only("operation", "imageId") || typeof body.imageId !== "string" || !UUID_PATTERN.test(body.imageId)) return supplierDenied();
      const { data: image, error } = await db.from("sourcing_product_images")
        .select("id,object_path,mime_type,byte_size,ready").eq("id", body.imageId)
        .eq("supplier_id", link.supplier_id).eq("uploaded_by_supplier", true).maybeSingle();
      if (error || !image) return supplierDenied();
      if (image.ready) return supplierJson({ ok: true });
      const checked = await verifyUploadedImage(db, image);
      if (!checked.ok) return supplierJson({ error: checked.error }, 400);
      const { error: finishError } = await mutate("finish_image", { id: image.id });
      if (finishError) return failure(finishError, "Unable to save the image.");
      revalidatePath("/products");
      return supplierJson({ ok: true });
    }

    return supplierJson({ error: "Invalid operation." }, 400);
  } catch {
    return supplierJson({ error: "Unable to save. Please try again." }, 400);
  }
}
