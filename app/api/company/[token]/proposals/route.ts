import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { BUCKET, companyScope } from "@/lib/company-portal";
import { parseQuantityText } from "@/lib/company-orders";
import { imageMime } from "@/lib/supplier-validation";
import { supplierDenied, supplierJson } from "@/lib/supplier-http";

export const dynamic = "force-dynamic";

const MAX_PHOTOS = 3;
const MAX_TOTAL_BYTES = 4_000_000; // Vercel rejects larger request bodies; the form shrinks photos before sending.
const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

// A company suggests a new product. It only goes to Nexo for review; it never enters the catalog by itself.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let scope;
  try { scope = await companyScope(token); } catch { return supplierDenied(); }
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("multipart/form-data")) {
    return supplierJson({ error: "Invalid request." }, 400);
  }
  if (Number(request.headers.get("content-length") ?? "0") > MAX_TOTAL_BYTES + 200_000) {
    return supplierJson({ error: "The photos are too large. Use fewer or smaller photos." }, 400);
  }
  let form: FormData;
  try { form = await request.formData(); } catch { return supplierJson({ error: "Invalid request." }, 400); }

  const text = (key: string, max: number) => String(form.get(key) ?? "").trim().slice(0, max);
  const name = text("name", 200);
  if (!name) return supplierJson({ error: "Enter the product name." }, 400);
  const description = text("description", 3000) || null;
  const link = text("link", 1000) || null;
  if (link && !/^https?:\/\//i.test(link)) return supplierJson({ error: "The link must start with http:// or https://." }, 400);
  const quantityText = text("quantity", 20);
  const quantity = quantityText ? parseQuantityText(quantityText) : null;
  if (quantityText && quantity === null) return supplierJson({ error: "Enter a valid quantity." }, 400);

  const files = form.getAll("photos").filter((value): value is File => typeof value !== "string" && value.size > 0);
  if (files.length > MAX_PHOTOS) return supplierJson({ error: `You can add at most ${MAX_PHOTOS} photos.` }, 400);
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) return supplierJson({ error: "The photos are too large. Use fewer or smaller photos." }, 400);
  const photos: { bytes: Uint8Array; mime: string }[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = imageMime(bytes);
    if (!mime) return supplierJson({ error: "Only JPG, PNG, WEBP or GIF photos are allowed." }, 400);
    photos.push({ bytes, mime });
  }

  const { db, link: companyLink } = scope;
  try {
    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const recent = await db.from("sourcing_company_proposals").select("id", { count: "exact", head: true })
      .eq("company_id", companyLink.company_id).gte("created_at", since);
    if ((recent.count ?? 0) >= 10) return supplierJson({ error: "Too many suggestions in a short time. Please try again later." }, 429);

    const created = await db.from("sourcing_company_proposals")
      .insert({ company_id: companyLink.company_id, name, description, link, quantity }).select("id").single();
    if (created.error || !created.data) return supplierJson({ error: "Unable to send. Please try again." }, 400);
    const uploaded: { path: string; mime: string }[] = [];
    for (const photo of photos) {
      const path = `company-proposals/${companyLink.company_id}/${created.data.id}/${randomUUID()}.${EXTENSION[photo.mime]}`;
      const result = await db.storage.from(BUCKET).upload(path, photo.bytes, { contentType: photo.mime, upsert: false });
      if (result.error) {
        if (uploaded.length) await db.storage.from(BUCKET).remove(uploaded.map(item => item.path));
        await db.from("sourcing_company_proposals").delete().eq("id", created.data.id);
        return supplierJson({ error: "Unable to upload the photos. Please try again." }, 400);
      }
      uploaded.push({ path, mime: photo.mime });
    }
    if (uploaded.length) {
      const saved = await db.from("sourcing_company_proposal_images")
        .insert(uploaded.map(item => ({ proposal_id: created.data.id, object_path: item.path, mime_type: item.mime })));
      if (saved.error) {
        await db.storage.from(BUCKET).remove(uploaded.map(item => item.path));
        await db.from("sourcing_company_proposals").delete().eq("id", created.data.id);
        return supplierJson({ error: "Unable to send. Please try again." }, 400);
      }
    }
    revalidatePath("/company-orders");
    return supplierJson({ ok: true });
  } catch {
    return supplierJson({ error: "Unable to send. Please try again." }, 400);
  }
}
