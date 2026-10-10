"use server";

import { revalidatePath } from "next/cache";
import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { readXlsx } from "@/lib/xlsx-lite";
import { MAX_IMPORT_BYTES, parseProductSheet } from "@/lib/product-import";

export type ImportResult = {
  ok: boolean; dryRun: boolean; created: number; updated: number; errors: string[]; warnings: string[]; error?: string;
};

const fail = (error: string, dryRun = true): ImportResult => ({ ok: false, dryRun, created: 0, updated: 0, errors: [], warnings: [], error });

// Reads an uploaded .xlsx and creates or updates the products of ONE supplier.
// A product is matched by its code (SKU). Nothing is written if any row is invalid.
// Imported products are created already approved (Nexo is the one importing).
export async function importProductsAction(formData: FormData): Promise<ImportResult> {
  const { user } = await requireSourcingAccess();
  const dryRun = formData.get("dry") !== "0";
  try {
    const supplierId = String(formData.get("supplier_id") ?? "");
    const file = formData.get("file");
    if (!UUID_PATTERN.test(supplierId)) return fail("Select a supplier.", dryRun);
    if (!(file instanceof File) || !file.size) return fail("Choose an Excel (.xlsx) file.", dryRun);
    if (file.size > MAX_IMPORT_BYTES) return fail("The file is too large. Photos do not belong in this file; upload them separately.", dryRun);
    if (!/\.xlsx$/i.test(file.name)) return fail("Only .xlsx files are supported. In Excel use Save As → Excel Workbook.", dryRun);

    let parsed;
    try { parsed = parseProductSheet(readXlsx(Buffer.from(await file.arrayBuffer())).rows); }
    catch (error) { return fail(error instanceof Error ? error.message : "The Excel file could not be read.", dryRun); }
    if (parsed.errors.length) return { ok: false, dryRun, created: 0, updated: 0, errors: parsed.errors.slice(0, 60), warnings: parsed.warnings };
    if (!parsed.rows.length) return fail("The file has no product rows.", dryRun);

    const db = adminDb();
    const { data: supplier } = await db.from("sourcing_suppliers").select("id").eq("id", supplierId).maybeSingle();
    if (!supplier) return fail("Supplier not found.", dryRun);
    const { data: existing, error: existingError } = await db.from("sourcing_products").select("id,sku").eq("supplier_id", supplierId).limit(20000);
    if (existingError) return fail("Unable to read the current products. Run the latest SQL migration first.", dryRun);
    const bySku = new Map<string, string>((existing ?? []).map((row: any) => [String(row.sku).toLowerCase(), row.id]));

    const toCreate = parsed.rows.filter(row => !(row.sku && bySku.has(row.sku.toLowerCase())));
    const toUpdate = parsed.rows.filter(row => row.sku && bySku.has(row.sku.toLowerCase()));
    const result: ImportResult = { ok: true, dryRun, created: toCreate.length, updated: toUpdate.length, errors: [], warnings: parsed.warnings };
    if (dryRun) return result;

    const now = new Date().toISOString();
    for (let start = 0; start < toCreate.length; start += 100) {
      const chunk = toCreate.slice(start, start + 100).map(row => ({
        ...row.fields, ...(row.sku ? { sku: row.sku } : {}), supplier_id: supplierId, status: "approved",
        created_by_supplier: false, created_by: user.id, approved_by: user.id, approved_at: now
      }));
      const { error } = await db.from("sourcing_products").insert(chunk);
      if (error) {
        revalidatePath("/products");
        return { ...result, ok: false, created: start, updated: 0, errors: [`Stopped while creating products (rows ${start + 1}+): ${error.message}. Rows before this point were saved; fix the file and import again.`] };
      }
    }
    let updated = 0;
    for (let start = 0; start < toUpdate.length; start += 10) {
      const outcomes = await Promise.all(toUpdate.slice(start, start + 10).map(row =>
        db.from("sourcing_products").update({ ...row.fields, updated_at: now }).eq("id", bySku.get(row.sku!.toLowerCase())).eq("supplier_id", supplierId)));
      for (const outcome of outcomes) if (!outcome.error) updated++;
    }
    revalidatePath("/products");
    return { ...result, updated, errors: updated < toUpdate.length ? [`${toUpdate.length - updated} row(s) could not be updated. Import again to retry.`] : [] };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The import failed.", dryRun);
  }
}
