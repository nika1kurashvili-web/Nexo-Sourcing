import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { STATUS_LABELS, lineTotal, orderTotals, type OrderStatus } from "@/lib/orders";
import { writeXlsx, type Cell } from "@/lib/xlsx-lite";

export const dynamic = "force-dynamic";

// Staff-only Excel download of one order: products, prices, totals and payments.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireSourcingAccess();
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return new Response("Not found", { status: 404 });
  const db = adminDb();
  const [orderResult, itemsResult, paymentsResult] = await Promise.all([
    db.from("sourcing_orders").select("*, sourcing_suppliers(name)").eq("id", id).maybeSingle(),
    db.from("sourcing_order_items").select("*").eq("order_id", id).order("created_at"),
    db.from("sourcing_order_payments").select("*").eq("order_id", id).order("paid_on").order("created_at")
  ]);
  const order = orderResult.data;
  if (!order) return new Response("Not found", { status: 404 });
  const items: any[] = itemsResult.data ?? [];
  const payments: any[] = paymentsResult.data ?? [];
  const totals = orderTotals(items, payments.map(payment => payment.amount));
  const num = (value: unknown): Cell => (value === null || value === undefined ? null : Number(value));

  const rows: Cell[][] = [
    ["Order", order.order_no],
    ["Supplier", order.sourcing_suppliers?.name ?? ""],
    ["Currency", order.currency],
    ["Status", STATUS_LABELS[order.status as OrderStatus] ?? order.status],
    [],
    ["Code", "Product", "Quantity", `Price (${order.currency})`, `Line total (${order.currency})`, "Supplier price suggestion", "Supplier quantity suggestion", "Prepared"],
    ...items.map((item): Cell[] => [
      item.sku, item.product_name, num(item.quantity), num(item.unit_price), lineTotal(item.quantity, item.unit_price),
      num(item.proposed_price), num(item.proposed_quantity), item.prepared_at ? "Yes" : "No"
    ]),
    [],
    ["", "", "", "Total", totals.total],
    ["", "", "", "Paid", totals.paid],
    ["", "", "", totals.balance < 0 ? "Overpaid" : "Remaining", Math.abs(totals.balance)]
  ];
  const paymentRows: Cell[][] = [
    ["Date", `Amount (${order.currency})`, "Note"],
    ...payments.map((payment): Cell[] => [payment.paid_on, num(payment.amount), payment.note ?? null])
  ];

  // The bold header style applies to row 1 of each sheet, so the order facts go on their own sheet part:
  // keep one sheet for the products table (clean to filter in Excel) and one for payments.
  const productSheet: Cell[][] = rows.slice(5);
  const info: Cell[][] = [["Order", "Supplier", "Currency", "Status"], [order.order_no, order.sourcing_suppliers?.name ?? "", order.currency, STATUS_LABELS[order.status as OrderStatus] ?? order.status]];
  const file = writeXlsx([
    { name: "Order", rows: [...info, [], ...productSheet], widths: [14, 36, 12, 16, 18, 20, 12] },
    { name: "Payments", rows: paymentRows, widths: [14, 18, 40] }
  ]);
  const name = String(order.order_no).replace(/[^a-zA-Z0-9-]+/g, "-");
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}.xlsx"`,
      "Cache-Control": "private, no-store"
    }
  });
}
