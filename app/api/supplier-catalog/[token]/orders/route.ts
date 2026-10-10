import { revalidatePath } from "next/cache";
import { catalogScope } from "@/lib/catalog-portal";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { supplierBody, supplierDenied, supplierJson } from "@/lib/supplier-http";

export const dynamic = "force-dynamic";

// The only thing a supplier can do to an order: suggest (or clear) the price of a line while
// the order is "sent". A suggestion changes nothing until Nexo approves it.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let scope;
  try { scope = await catalogScope(token); } catch { return supplierDenied(); }
  let body: Record<string, unknown>;
  try { body = await supplierBody(request, 2000); }
  catch { return supplierJson({ error: "Invalid request." }, 400); }
  if (Object.keys(body).some(key => !["operation", "itemId", "price"].includes(key))
    || body.operation !== "set_price" || typeof body.itemId !== "string" || !UUID_PATTERN.test(body.itemId)) {
    return supplierDenied();
  }
  let price: number | null = null;
  const raw = body.price;
  if (raw !== null && raw !== "" && raw !== undefined) {
    const text = String(raw).trim().replace(",", ".");
    price = /^\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
    if (!Number.isFinite(price) || price < 0 || price > 9999999) return supplierJson({ error: "Enter a valid price." }, 400);
  }
  try {
    const { error } = await scope.db.rpc("sourcing_order_supplier", {
      p_hash: scope.hash, p_operation: "set_price", p_payload: { item_id: body.itemId, price }
    });
    if (error) {
      const text = String(error.message ?? "");
      if (text.includes("Order is locked")) return supplierJson({ error: "This order is no longer open for price changes." }, 400);
      if (text.includes("Invalid supplier access")) return supplierDenied();
      return supplierJson({ error: "Unable to save the price." }, 400);
    }
    revalidatePath("/orders");
    return supplierJson({ ok: true });
  } catch {
    return supplierJson({ error: "Unable to save the price. Please try again." }, 400);
  }
}
