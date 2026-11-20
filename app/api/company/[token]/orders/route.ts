import { revalidatePath } from "next/cache";
import { companyScope } from "@/lib/company-portal";
import { parseOrderLines } from "@/lib/company-orders";
import { supplierBody, supplierDenied, supplierJson } from "@/lib/supplier-http";

export const dynamic = "force-dynamic";

// A company sends an order to Nexo. Prices and names are read from the database here, never from the
// browser, and only products that Nexo marked for this company can be ordered.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let scope;
  try { scope = await companyScope(token); } catch { return supplierDenied(); }
  let body: Record<string, unknown>;
  try { body = await supplierBody(request, 30000); }
  catch { return supplierJson({ error: "Invalid request." }, 400); }
  if (Object.keys(body).some(key => key !== "items" && key !== "note")) return supplierDenied();
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") return supplierDenied();
  const note = String(body.note ?? "").trim().slice(0, 1000) || null;
  let lines;
  try { lines = parseOrderLines(body.items, 100); }
  catch (error) { return supplierJson({ error: error instanceof Error ? error.message : "Invalid order." }, 400); }

  const { db, link } = scope;
  try {
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const recent = await db.from("sourcing_company_orders").select("id", { count: "exact", head: true })
      .eq("company_id", link.company_id).gte("created_at", since);
    if ((recent.count ?? 0) >= 10) return supplierJson({ error: "Too many orders in a short time. Please wait a few minutes." }, 429);

    const available = await db.from("sourcing_company_products")
      .select("product_id,sell_price,currency,sourcing_products!inner(id,sku,name,status)")
      .eq("company_id", link.company_id).in("product_id", lines.map(line => line.productId)).eq("sourcing_products.status", "approved");
    if (available.error) return supplierJson({ error: "Unable to send the order. Please try again." }, 400);
    const byProduct = new Map<string, any>((available.data ?? []).map((row: any) => [row.product_id as string, row]));
    if (lines.some(line => !byProduct.has(line.productId))) {
      return supplierJson({ error: "Some products are no longer available. Reload the page and try again." }, 400);
    }

    const created = await db.from("sourcing_company_orders").insert({ company_id: link.company_id, note }).select("id,order_no").single();
    if (created.error || !created.data) return supplierJson({ error: "Unable to send the order. Please try again." }, 400);
    const items = lines.map(line => {
      const row = byProduct.get(line.productId);
      return {
        order_id: created.data.id, product_id: line.productId, sku: row.sourcing_products.sku ?? null, product_name: row.sourcing_products.name,
        quantity: line.quantity, unit_price: row.sell_price === null ? null : Number(row.sell_price), currency: row.currency
      };
    });
    const inserted = await db.from("sourcing_company_order_items").insert(items);
    if (inserted.error) {
      await db.from("sourcing_company_orders").delete().eq("id", created.data.id);
      return supplierJson({ error: "Unable to send the order. Please try again." }, 400);
    }
    revalidatePath("/company-orders");
    return supplierJson({ ok: true, orderNo: created.data.order_no as string });
  } catch {
    return supplierJson({ error: "Unable to send the order. Please try again." }, 400);
  }
}
