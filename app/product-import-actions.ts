"use server";

import { revalidatePath } from "next/cache";
import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { readXlsx } from "@/lib/xlsx-lite";
import { MAX_IMPORT_BYTES, parseProductSheet } from "@/lib/product-import";

type ImportRowRef = object;
export type ImportResult = {
  ok: boolean; dryRun: boolean; created: number; updated: number; prices?: number; errors: string[]; warnings: string[]; error?: string;
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

    const db = adminDb();
    // Companies whose sell-price columns may be in the sheet (a missing table just means "no companies").
    const companiesResult = await db.from("sourcing_companies").select("id,name");
    const companies: { id: string; name: string }[] = companiesResult.error ? [] : (companiesResult.data ?? []);
    let parsed;
    try { parsed = parseProductSheet(readXlsx(Buffer.from(await file.arrayBuffer())).rows, companies); }
    catch (error) { return fail(error instanceof Error ? error.message : "The Excel file could not be read.", dryRun); }
    if (parsed.errors.length) return { ok: false, dryRun, created: 0, updated: 0, errors: parsed.errors.slice(0, 60), warnings: parsed.warnings };
    if (!parsed.rows.length) return fail("The file has no product rows.", dryRun);

    const priceCount = parsed.rows.reduce((sum, row) => sum + row.companyPrices.length, 0);
    if (priceCount > 0) {
      const probe = await db.from("sourcing_company_products").select("product_id").limit(1);
      if (probe.error) return fail("Company prices need the company portal tables. Run supabase/migrations/20261017_company_portal.sql first.", dryRun);
    }
    const { data: supplier } = await db.from("sourcing_suppliers").select("id").eq("id", supplierId).maybeSingle();
    if (!supplier) return fail("Supplier not found.", dryRun);
    const { data: existing, error: existingError } = await db.from("sourcing_products").select("id,sku").eq("supplier_id", supplierId).limit(20000);
    if (existingError) return fail("Unable to read the current products. Run the latest SQL migration first.", dryRun);
    const bySku = new Map<string, string>((existing ?? []).map((row: any) => [String(row.sku).toLowerCase(), row.id]));

    const toCreate = parsed.rows.filter(row => !(row.sku && bySku.has(row.sku.toLowerCase())));
    const toUpdate = parsed.rows.filter(row => row.sku && bySku.has(row.sku.toLowerCase()));
    const result: ImportResult = { ok: true, dryRun, created: toCreate.length, updated: toUpdate.length, prices: priceCount, errors: [], warnings: parsed.warnings };
    if (dryRun) return result;

    const now = new Date().toISOString();
    // Rows with and without a code are inserted separately: a bulk insert fills a missing key with NULL
    // instead of using the column default, which would break the automatic code (P00012...).
    let created = 0;
    const productIdOf = new Map<ImportRowRef, string>();
    for (const group of [toCreate.filter(row => row.sku), toCreate.filter(row => !row.sku)]) {
      for (let start = 0; start < group.length; start += 100) {
        const chunk = group.slice(start, start + 100).map(row => ({
          ...row.fields, ...(row.sku ? { sku: row.sku } : {}), supplier_id: supplierId, status: "approved",
          created_by_supplier: false, created_by: user.id, approved_by: user.id, approved_at: now
        }));
        const { data: inserted, error } = await db.from("sourcing_products").insert(chunk).select("id");
        if (error) {
          console.error("Product import failed", error);
          revalidatePath("/products");
          return { ...result, ok: false, created, updated: 0, errors: [`Stopped while creating products: ${error.message}. ${created} product(s) were saved before this; fix the file and import again (existing codes are updated, not duplicated).`] };
        }
        // PostgREST returns the new rows in insert order, so rows and ids line up.
        group.slice(start, start + 100).forEach((row, index) => { if (inserted?.[index]?.id) productIdOf.set(row, inserted[index].id); });
        created += chunk.length;
      }
    }
    let updated = 0;
    for (let start = 0; start < toUpdate.length; start += 10) {
      const outcomes = await Promise.all(toUpdate.slice(start, start + 10).map(row =>
        db.from("sourcing_products").update({ ...row.fields, updated_at: now }).eq("id", bySku.get(row.sku!.toLowerCase())).eq("supplier_id", supplierId)));
      for (const outcome of outcomes) if (!outcome.error) updated++;
    }

    // Company sell prices: a filled price makes the product visible to that company at that price.
    const errors: string[] = updated < toUpdate.length ? [`${toUpdate.length - updated} row(s) could not be updated. Import again to retry.`] : [];
    if (priceCount > 0) {
      for (const row of toUpdate) productIdOf.set(row, bySku.get(row.sku!.toLowerCase())!);
      const priced = parsed.rows.filter(row => row.companyPrices.length && productIdOf.has(row));
      const ids = Array.from(new Set(priced.map(row => productIdOf.get(row)!)));
      const currentCurrency = new Map<string, string>();
      for (let start = 0; start < ids.length; start += 100) {
        const { data } = await db.from("sourcing_company_products").select("product_id,company_id,currency").in("product_id", ids.slice(start, start + 100));
        for (const item of data ?? []) currentCurrency.set(`${item.product_id}|${item.company_id}`, item.currency);
      }
      const assignments = priced.flatMap(row => row.companyPrices.map(price => {
        const productId = productIdOf.get(row)!;
        return { product_id: productId, company_id: price.companyId, sell_price: price.price, currency: price.currency ?? currentCurrency.get(`${productId}|${price.companyId}`) ?? "GEL" };
      }));
      let saved = 0;
      for (let start = 0; start < assignments.length; start += 200) {
        const chunk = assignments.slice(start, start + 200);
        const { error } = await db.from("sourcing_company_products").upsert(chunk, { onConflict: "product_id,company_id" });
        if (error) errors.push(`Some company prices could not be saved (${error.message}). Import again to retry.`);
        else saved += chunk.length;
      }
      result.prices = saved;
    }
    revalidatePath("/products");
    return { ...result, updated, errors };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The import failed.", dryRun);
  }
}
