"use server";

import { randomBytes, createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSourcingAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_PRODUCT_IMAGES, UUID_PATTERN, parseProductFields } from "@/lib/catalog-validation";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/supplier-validation";
import { catalogLinkUrl, encryptShareToken } from "@/lib/share-link-crypto";
import { removeStoragePaths, signedUploadToken, verifyUploadedImage } from "@/lib/catalog-images";

// Every action first runs requireSourcingAccess() (staff only). The catalog tables are
// closed to browser clients, so all reads and writes use the server-only service client.
function adminDb(): any {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Configure SUPABASE_SERVICE_ROLE_KEY on the server to use the product catalog.");
  }
  return createAdminClient();
}

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export async function saveProductAction(input: { id?: string; supplierId?: string; fields: Record<string, unknown> }) {
  const { user } = await requireSourcingAccess();
  try {
    const db = adminDb();
    const values = parseProductFields(input?.fields, { staff: true });
    if (input.id) {
      if (!UUID_PATTERN.test(input.id)) return { error: "Invalid product." };
      const { data, error } = await db.from("sourcing_products")
        .update({ ...values, updated_at: new Date().toISOString() }).eq("id", input.id).select("id").maybeSingle();
      if (error || !data) return { error: "Unable to save the product." };
      revalidatePath("/products");
      return { id: data.id as string };
    }
    if (!input.supplierId || !UUID_PATTERN.test(input.supplierId)) return { error: "Select a supplier." };
    const now = new Date().toISOString();
    const { data, error } = await db.from("sourcing_products").insert({
      ...values, supplier_id: input.supplierId, status: "approved", created_by_supplier: false,
      created_by: user.id, approved_by: user.id, approved_at: now
    }).select("id").single();
    if (error || !data) return { error: "Unable to create the product." };
    revalidatePath("/products");
    return { id: data.id as string };
  } catch (error) {
    return { error: message(error, "Unable to save the product.") };
  }
}

export async function deleteProductAction(formData: FormData) {
  await requireSourcingAccess();
  const id = String(formData.get("id") ?? "");
  if (!UUID_PATTERN.test(id)) return;
  const db = adminDb();
  const { data: images } = await db.from("sourcing_product_images").select("object_path").eq("product_id", id);
  const { error } = await db.from("sourcing_products").delete().eq("id", id);
  if (!error) await removeStoragePaths(db, (images ?? []).map((image: any) => image.object_path));
  revalidatePath("/products");
}

export async function deleteProductImageAction(formData: FormData) {
  await requireSourcingAccess();
  const imageId = String(formData.get("imageId") ?? "");
  if (!UUID_PATTERN.test(imageId)) return;
  const db = adminDb();
  const { data } = await db.from("sourcing_product_images").delete().eq("id", imageId).select("object_path").maybeSingle();
  if (data) await removeStoragePaths(db, [data.object_path]);
  revalidatePath("/products");
}

export async function prepareProductImageAction(productId: string, mime: string, size: number) {
  await requireSourcingAccess();
  try {
    if (!UUID_PATTERN.test(productId) || !(IMAGE_TYPES as readonly string[]).includes(mime)
      || !Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
      return { error: "Choose a JPEG, PNG, WebP, or GIF image up to 10 MB." };
    }
    const db = adminDb();
    const { data: product } = await db.from("sourcing_products").select("id,supplier_id").eq("id", productId).maybeSingle();
    if (!product) return { error: "Product not found." };
    const { count } = await db.from("sourcing_product_images").select("id", { count: "exact", head: true }).eq("product_id", productId);
    if ((count ?? 0) >= MAX_PRODUCT_IMAGES) return { error: `A product can have at most ${MAX_PRODUCT_IMAGES} photos.` };
    const id = randomUUID();
    const path = `catalog/${product.supplier_id}/${product.id}/${id}`;
    const { error } = await db.from("sourcing_product_images").insert({
      id, product_id: product.id, supplier_id: product.supplier_id, object_path: path,
      mime_type: mime, byte_size: size, approved: true, uploaded_by_supplier: false
    });
    if (error) return { error: "Unable to start the upload." };
    const uploadToken = await signedUploadToken(db, path);
    if (!uploadToken) return { error: "Unable to start the upload. Please try again." };
    return { id, path, uploadToken };
  } catch (error) {
    return { error: message(error, "Unable to start the upload.") };
  }
}

export async function finishProductImageAction(imageId: string) {
  await requireSourcingAccess();
  try {
    if (!UUID_PATTERN.test(imageId)) return { error: "Invalid image." };
    const db = adminDb();
    const { data: image } = await db.from("sourcing_product_images")
      .select("id,object_path,mime_type,byte_size,ready").eq("id", imageId).eq("uploaded_by_supplier", false).maybeSingle();
    if (!image) return { error: "Invalid image." };
    if (image.ready) return { ok: true };
    const checked = await verifyUploadedImage(db, image);
    if (!checked.ok) {
      await db.from("sourcing_product_images").delete().eq("id", image.id);
      return { error: checked.error };
    }
    const { error } = await db.from("sourcing_product_images").update({ ready: true }).eq("id", image.id);
    if (error) return { error: "Unable to save the image." };
    revalidatePath("/products");
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Unable to save the image.") };
  }
}

// Staff decision on a supplier submission: a new product ("product") or an edit/delete request ("change").
export async function decideSubmissionAction(formData: FormData) {
  const { user } = await requireSourcingAccess();
  const kind = String(formData.get("kind") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const id = String(formData.get("id") ?? "");
  if (!["product", "change"].includes(kind) || !["approve", "reject"].includes(decision) || !UUID_PATTERN.test(id)) return;
  const db = adminDb();
  const { data, error } = await db.rpc("sourcing_catalog_decide", { p_kind: kind, p_id: id, p_decision: decision, p_user: user.id });
  if (!error) await removeStoragePaths(db, data?.removed_paths);
  revalidatePath("/products");
}

export async function createCatalogLinkAction(supplierId: string) {
  const { user } = await requireSourcingAccess();
  try {
    if (!UUID_PATTERN.test(supplierId)) return { error: "Invalid supplier." };
    const db = adminDb();
    const { data: supplier } = await db.from("sourcing_suppliers").select("id").eq("id", supplierId).maybeSingle();
    if (!supplier) return { error: "Supplier not found." };
    const token = randomBytes(32).toString("hex");
    const { data, error } = await db.from("sourcing_catalog_links").insert({
      supplier_id: supplierId, token_hash: createHash("sha256").update(token).digest("hex"),
      token_encrypted: encryptShareToken(token), created_by: user.id
    }).select("id").single();
    if (error || !data) return { error: "Unable to create the link. Revoke the active link for this supplier first." };
    revalidatePath("/products");
    return { id: data.id as string, url: catalogLinkUrl(token) };
  } catch (error) {
    return { error: message(error, "Unable to create the link.") };
  }
}

export async function revokeCatalogLinkAction(supplierId: string, linkId: string) {
  await requireSourcingAccess();
  try {
    if (!UUID_PATTERN.test(supplierId) || !UUID_PATTERN.test(linkId)) return { error: "Invalid link." };
    const db = adminDb();
    const { error } = await db.from("sourcing_catalog_links").update({ active: false, revoked_at: new Date().toISOString() })
      .eq("id", linkId).eq("supplier_id", supplierId).eq("active", true);
    if (error) return { error: "Unable to revoke the link. Please try again." };
    revalidatePath("/products");
    return { ok: true };
  } catch (error) {
    return { error: message(error, "Unable to revoke the link.") };
  }
}
