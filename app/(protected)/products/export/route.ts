import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { SHEET_COLUMNS, companyHeader, exportRows } from "@/lib/product-import";
import { writeXlsx } from "@/lib/xlsx-lite";

export const dynamic = "force-dynamic";

const HELP = [
  ["How to use this file"],
  ["1. Keep the header row (row 1) of the first sheet. Add one product per row below it."],
  ["2. Code (SKU) identifies a product. A row whose code already exists for the chosen supplier UPDATES that product; a new or empty code creates a new product."],
  ["3. Name is required. Leave a cell empty to clear that value. Delete a column to leave that field untouched."],
  ["4. Currency: USD, CNY, EUR or GEL. Lead time and Quantity in box must be whole numbers."],
  ["5. Photos are NOT in this file. After importing, use \"Upload photos by code\" on the Products page: name each photo after the product code, e.g. P00012.jpg, P00012_2.jpg."],
  ["6. The import is for one supplier at a time, chosen on the Products page."],
  ["7. Company prices: each company has two columns, \"Sell price: <Company>\" and \"Sell currency: <Company>\". A filled price makes the product visible to that company at that price (the currency is optional: GEL for a new price, otherwise the current one). An empty price cell changes nothing. To hide a product from a company, use Products > \"Companies & sell price\". The company name in the header must match the Companies page exactly."]
].map(row => [...row]);

// Staff-only Excel download: the current products (optionally one supplier), or just the template.
export async function GET(request: Request) {
  await requireSourcingAccess();
  const url = new URL(request.url);
  const template = url.searchParams.get("template") === "1";
  const supplier = url.searchParams.get("supplier") ?? "";
  const db = adminDb();

  // Company sell-price columns (empty when the company portal migration has not been run yet).
  const companiesResult = await db.from("sourcing_companies").select("id,name").order("name");
  const companies: { id: string; name: string }[] = companiesResult.error ? [] : (companiesResult.data ?? []);
  const assigned = new Map<string, { sell_price: number | string | null; currency: string }>();
  if (!template && companies.length) {
    const assignedResult = await db.from("sourcing_company_products").select("product_id,company_id,sell_price,currency").range(0, 19999);
    for (const row of assignedResult.data ?? []) assigned.set(`${row.product_id}|${row.company_id}`, { sell_price: row.sell_price, currency: row.currency });
  }

  let rows: unknown[][];
  let filename = "products";
  if (template) {
    rows = [[...SHEET_COLUMNS.map(column => column.label), ...companyHeader(companies)]];
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
      rows = exportRows(products ?? [], undefined, companies, assigned);
    } else {
      rows = exportRows(products ?? [], suppliers, companies, assigned);
    }
  }

  const widths = [...((rows[0] as unknown[]).length > SHEET_COLUMNS.length + companies.length * 2 ? [20] : []), ...SHEET_COLUMNS.map(column => column.width), ...companies.flatMap(() => [16, 14])];
  const file = writeXlsx([
    { name: "Products", rows: rows as any, widths },
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
