import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { SHEET_COLUMNS, exportRows } from "@/lib/product-import";
import { writeXlsx } from "@/lib/xlsx-lite";

export const dynamic = "force-dynamic";

const HELP = [
  ["How to use this file"],
  ["1. Keep the header row (row 1) of the first sheet. Add one product per row below it."],
  ["2. Code (SKU) identifies a product. A row whose code already exists for the chosen supplier UPDATES that product; a new or empty code creates a new product."],
  ["3. Name is required. Leave a cell empty to clear that value. Delete a column to leave that field untouched."],
  ["4. Currency: USD, CNY, EUR or GEL. Lead time and Quantity in box must be whole numbers."],
  ["5. Photos are NOT in this file. After importing, use \"Upload photos by code\" on the Products page: name each photo after the product code, e.g. P00012.jpg, P00012_2.jpg."],
  ["6. The import is for one supplier at a time, chosen on the Products page."]
].map(row => [...row]);

// Staff-only Excel download: the current products (optionally one supplier), or just the template.
export async function GET(request: Request) {
  await requireSourcingAccess();
  const url = new URL(request.url);
  const template = url.searchParams.get("template") === "1";
  const supplier = url.searchParams.get("supplier") ?? "";
  const db = adminDb();

  let rows: unknown[][];
  let filename = "products";
  if (template) {
    rows = [SHEET_COLUMNS.map(column => column.label)];
    filename = "products-template";
  } else {
    let query = db.from("sourcing_products").select("*").order("name").limit(5000);
    let suppliers: Map<string, string> | undefined;
    if (supplier && UUID_PATTERN.test(supplier)) query = query.eq("supplier_id", supplier);
    const [{ data: products, error }, { data: supplierRows }] = await Promise.all([query, db.from("sourcing_suppliers").select("id,name")]);
    if (error) return new Response("Unable to export. Run the latest SQL migration first.", { status: 500 });
    suppliers = new Map((supplierRows ?? []).map((row: any) => [row.id, row.name]));
    if (supplier && UUID_PATTERN.test(supplier)) {
      filename = `products-${String(suppliers.get(supplier) ?? "supplier").replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40)}`;
      rows = exportRows(products ?? []);
    } else {
      rows = exportRows(products ?? [], suppliers);
    }
  }

  const widths = SHEET_COLUMNS.map(column => column.width);
  const file = writeXlsx([
    { name: "Products", rows: rows as any, widths: rows[0] && (rows[0] as unknown[]).length > widths.length ? [20, ...widths] : widths },
    { name: "Help", rows: HELP as any, widths: [120] }
  ]);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      "Cache-Control": "private, no-store"
    }
  });
}
