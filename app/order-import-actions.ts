"use server";

import { revalidatePath } from "next/cache";
import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { readXlsx } from "@/lib/xlsx-lite";
import { MAX_ORDER_BYTES, parseOrderSheet } from "@/lib/order-import";
import { ORDER_CURRENCIES } from "@/lib/orders";

export type OrderImportResult = {
  ok: boolean; dryRun: boolean; lines: number; priced: number; unpriced: number;
  orderId?: string; errors: string[]; warnings: string[]; error?: string;
};

const fail = (error: string, dryRun: boolean): OrderImportResult =>
  ({ ok: false, dryRun, lines: 0, priced: 0, unpriced: 0, errors: [], warnings: [], error });

// Creates a draft order from an Excel file of barcode + quantity. Codes are matched to the chosen
// supplier's approved products; the catalog price is used when its currency equals the order's.
// All-or-nothing: if any row is invalid, no order is created.
export async function importOrderAction(formData: FormData): Promise<OrderImportResult> {
  const { user } = await requireSourcingAccess();
  const dryRun = formData.get("dry") !== "0";
  try {
    const supplierId = String(formData.get("supplier_id") ?? "");
    const currency = String(formData.get("currency") ?? "");
    const note = String(formData.get("note") ?? "").trim().slice(0, 5000) || null;
    const file = formData.get("file");
    if (!UUID_PATTERN.test(supplierId)) return fail("Select a supplier.", dryRun);
    if (!(ORDER_CURRENCIES as readonly string[]).includes(currency)) return fail("Select a currency.", dryRun);
    if (!(file instanceof File) || !file.size) return fail("Choose an Excel (.xlsx) file.", dryRun);
    if (file.size > MAX_ORDER_BYTES) return fail("The file is too large.", dryRun);
    if (!/\.xlsx$/i.test(file.name)) return fail("Only .xlsx files are supported. In Excel use Save As → Excel Workbook.", dryRun);

    let parsed;
    try { parsed = parseOrderSheet(readXlsx(Buffer.from(await file.arrayBuffer())).rows); }
    catch (error) { return fail(error instanceof Error ? error.message : "The Excel file could not be read.", dryRun); }
    if (parsed.errors.length) return { ...fail("", dryRun), error: undefined, errors: parsed.errors.slice(0, 60), warnings: parsed.warnings };
    if (!parsed.lines.length) return fail("The file has no rows.", dryRun);

    const db = adminDb();
    const { data: supplier } = await db.from("sourcing_suppliers").select("id").eq("id", supplierId).maybeSingle();
    if (!supplier) return fail("Supplier not found.", dryRun);
    const { data: products, error: productError } = await db.from("sourcing_products")
      .select("id,sku,name,price,currency").eq("supplier_id", supplierId).eq("status", "approved").limit(20000);
    if (productError) return fail("Unable to read the products. Run the latest SQL migrations first.", dryRun);
    const bySku = new Map<string, any>((products ?? []).map((row: any) => [String(row.sku).toLowerCase(), row]));

    const unknown = parsed.lines.filter(line => !bySku.has(line.code.toLowerCase()));
    if (unknown.length) {
      return { ...fail("", dryRun), error: undefined, warnings: parsed.warnings,
        errors: unknown.slice(0, 60).map(line => `Row ${line.line}: no approved product with barcode "${line.code}" for this supplier.`) };
    }

    const items = parsed.lines.map(line => {
      const product = bySku.get(line.code.toLowerCase());
      const usable = product.price !== null && product.currency === currency;
      return { product, quantity: line.quantity, price: usable ? product.price : null };
    });
    const priced = items.filter(item => item.price !== null).length;
    const warnings = [...parsed.warnings];
    if (priced < items.length) warnings.push(`${items.length - priced} product(s) have no catalog price in ${currency}; enter their prices in the order.`);
    const result: OrderImportResult = { ok: true, dryRun, lines: items.length, priced, unpriced: items.length - priced, errors: [], warnings };
    if (dryRun) return result;

    const { data: order, error: orderError } = await db.from("sourcing_orders")
      .insert({ supplier_id: supplierId, currency, note, created_by: user.id }).select("id").single();
    if (orderError || !order) return fail("Unable to create the order.", false);
    const { error: itemsError } = await db.from("sourcing_order_items").insert(items.map(item => ({
      order_id: order.id, product_id: item.product.id, sku: item.product.sku, product_name: item.product.name,
      quantity: item.quantity, unit_price: item.price
    })));
    if (itemsError) {
      // Do not leave an empty order behind.
      await db.from("sourcing_orders").delete().eq("id", order.id);
      return fail("Unable to add the products to the order. Nothing was created.", false);
    }
    revalidatePath("/orders");
    return { ...result, orderId: order.id };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The import failed.", dryRun);
  }
}
