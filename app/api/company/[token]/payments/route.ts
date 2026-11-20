import { revalidatePath } from "next/cache";
import { companyScope } from "@/lib/company-portal";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { parsePayment } from "@/lib/company-orders";
import { supplierBody, supplierDenied, supplierJson } from "@/lib/supplier-http";

export const dynamic = "force-dynamic";

// A company records a payment it made (it stays "pending" until Nexo confirms it) or withdraws its own pending one.
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let scope;
  try { scope = await companyScope(token); } catch { return supplierDenied(); }
  let body: Record<string, unknown>;
  try { body = await supplierBody(request, 4000); }
  catch { return supplierJson({ error: "Invalid request." }, 400); }
  if (typeof body.orderId !== "string" || !UUID_PATTERN.test(body.orderId)) return supplierDenied();
  const { db, link } = scope;

  try {
    const { data: order } = await db.from("sourcing_company_orders").select("id,status").eq("id", body.orderId).eq("company_id", link.company_id).maybeSingle();
    if (!order) return supplierDenied();

    if (body.operation === "withdraw") {
      if (Object.keys(body).some(key => !["operation", "orderId", "paymentId"].includes(key)) || typeof body.paymentId !== "string" || !UUID_PATTERN.test(body.paymentId)) return supplierDenied();
      const { error } = await db.from("sourcing_company_payments").delete()
        .eq("id", body.paymentId).eq("order_id", order.id).eq("entered_by", "company").eq("status", "pending");
      if (error) return supplierJson({ error: "Unable to withdraw the payment." }, 400);
      revalidatePath("/company-orders");
      return supplierJson({ ok: true });
    }

    if (body.operation !== "add" || Object.keys(body).some(key => !["operation", "orderId", "paidOn", "amount", "currency", "method", "note"].includes(key))) return supplierDenied();
    if (order.status === "cancelled") return supplierJson({ error: "This order was cancelled." }, 400);
    let payment;
    try { payment = parsePayment(body); }
    catch (error) { return supplierJson({ error: error instanceof Error ? error.message : "Invalid payment." }, 400); }

    const since = new Date(Date.now() - 60 * 60_000).toISOString();
    const recent = await db.from("sourcing_company_payments").select("id", { count: "exact", head: true })
      .eq("entered_by", "company").eq("order_id", order.id).gte("created_at", since);
    if ((recent.count ?? 0) >= 20) return supplierJson({ error: "Too many payments in a short time. Please try again later." }, 429);

    const { error } = await db.from("sourcing_company_payments").insert({
      order_id: order.id, paid_on: payment.paidOn, amount: payment.amount, currency: payment.currency, method: payment.method,
      note: payment.note, status: "pending", entered_by: "company"
    });
    if (error) return supplierJson({ error: "Unable to save the payment. Please try again." }, 400);
    revalidatePath("/company-orders");
    return supplierJson({ ok: true });
  } catch {
    return supplierJson({ error: "Unable to save the payment. Please try again." }, 400);
  }
}
