import Link from "next/link";
import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { createOrderAction } from "@/app/order-actions";
import { ORDER_CURRENCIES, STATUS_LABELS, money, orderTotals, type OrderStatus } from "@/lib/orders";
import { OrderExcelUpload } from "@/components/OrderExcelUpload";
import { UUID_PATTERN } from "@/lib/catalog-validation";

export const dynamic = "force-dynamic";

const BADGE: Record<string, string> = { draft: "", sent: "warning", confirmed: "success", cancelled: "danger" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ supplier?: string; status?: string; error?: string }> }) {
  const params = await searchParams;
  await requireSourcingAccess();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return <><div className="page-head"><div><h1>Orders</h1></div></div><div className="notice">Orders need SUPABASE_SERVICE_ROLE_KEY on the server.</div></>;
  }
  const db = adminDb();
  const supplierFilter = params.supplier && UUID_PATTERN.test(params.supplier) ? params.supplier : "";
  const statusFilter = ["draft", "sent", "confirmed", "cancelled"].includes(params.status ?? "") ? params.status! : "";

  let orderQuery = db.from("sourcing_orders")
    .select("id,order_no,supplier_id,currency,status,created_at,updated_at,sourcing_suppliers(name)")
    .order("created_at", { ascending: false }).limit(200);
  if (supplierFilter) orderQuery = orderQuery.eq("supplier_id", supplierFilter);
  if (statusFilter) orderQuery = orderQuery.eq("status", statusFilter);
  const [suppliersResult, ordersResult] = await Promise.all([db.from("sourcing_suppliers").select("id,name").order("name"), orderQuery]);

  if (ordersResult.error) {
    return <><div className="page-head"><div><h1>Orders</h1></div></div>
      <div className="notice">Orders are not set up yet. Run supabase/migrations/20261010_orders_and_sku.sql in the Supabase SQL Editor, then reload this page.</div></>;
  }
  const suppliers: any[] = suppliersResult.data ?? [];
  const orders: any[] = ordersResult.data ?? [];
  const ids = orders.map(order => order.id);
  const [itemsResult, paymentsResult] = ids.length ? await Promise.all([
    db.from("sourcing_order_items").select("order_id,quantity,unit_price,proposed_price,proposed_quantity,prepared_at").in("order_id", ids),
    db.from("sourcing_order_payments").select("order_id,amount").in("order_id", ids)
  ]) : [{ data: [] }, { data: [] }];
  const items: any[] = itemsResult.data ?? [];
  const payments: any[] = paymentsResult.data ?? [];

  return (
    <>
      <div className="page-head"><div><h1>Orders</h1><div className="muted">Orders to suppliers, prices, totals and payments</div></div></div>
      {params.error && <div className="notice">{params.error}</div>}

      <details className="card" style={{ marginBottom: 14 }}>
        <summary>+ New Order</summary>
        <form action={createOrderAction} className="form-grid" style={{ marginTop: 12 }}>
          <label>Supplier *
            <select name="supplier_id" required defaultValue={supplierFilter}>
              <option value="" disabled>Select supplier</option>
              {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>Currency (all prices and payments in this order use it)
            <select name="currency" defaultValue="USD">{ORDER_CURRENCIES.map(currency => <option key={currency} value={currency}>{currency}</option>)}</select>
          </label>
          <label>Note<textarea name="note" maxLength={5000} /></label>
          <div><button className="btn" type="submit">Create Order</button></div>
        </form>
      </details>

      <details className="card" style={{ marginBottom: 14 }}>
        <summary>⬆ Upload order from Excel (barcode + quantity)</summary>
        <OrderExcelUpload suppliers={suppliers.map(supplier => ({ id: supplier.id, name: supplier.name }))} />
      </details>

      <form method="get" className="card filter-bar">
        <label>Supplier
          <select name="supplier" defaultValue={supplierFilter}>
            <option value="">All suppliers</option>
            {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
        </label>
        <label>Status
          <select name="status" defaultValue={statusFilter}>
            <option value="">All</option>
            {(Object.keys(STATUS_LABELS) as OrderStatus[]).map(status => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
          </select>
        </label>
        <div className="filter-actions"><button className="btn" type="submit">Filter</button><Link className="btn secondary" href="/orders">Reset</Link></div>
      </form>

      {orders.length === 0 ? <div className="card empty">No orders yet.</div> : (
        <div className="card"><div className="table-wrap"><table>
          <thead><tr><th>Order</th><th>Supplier</th><th>Status</th><th>Total</th><th>Paid</th><th>Balance</th><th>Created</th></tr></thead>
          <tbody>{orders.map(order => {
            const totals = orderTotals(items.filter(item => item.order_id === order.id), payments.filter(p => p.order_id === order.id).map(p => p.amount));
            return (
              <tr key={order.id}>
                <td><Link className="row-link" href={`/orders/${order.id}`}>{order.order_no}</Link></td>
                <td>{order.sourcing_suppliers?.name ?? "—"}</td>
                <td><span className={`badge ${BADGE[order.status] ?? ""}`}>{STATUS_LABELS[order.status as OrderStatus] ?? order.status}</span>
                  {(order.status === "sent" || order.status === "confirmed") && (() => { const own = items.filter(item => item.order_id === order.id); const ready = own.filter(item => item.prepared_at).length; return own.length ? <span className={`badge ${ready === own.length ? "success" : ""}`} style={{ marginLeft: 6 }}>Prepared {ready}/{own.length}</span> : null; })()}
                  {totals.proposals > 0 && <span className="badge warning" style={{ marginLeft: 6 }}>{totals.proposals} price suggestion{totals.proposals === 1 ? "" : "s"}</span>}</td>
                <td>{money(totals.total, order.currency)}{totals.unpriced > 0 && <div className="small muted">{totals.unpriced} without price</div>}</td>
                <td>{money(totals.paid, order.currency)}</td>
                <td><strong>{money(totals.balance, order.currency)}</strong></td>
                <td>{new Date(order.created_at).toLocaleDateString("en-GB", { timeZone: "Asia/Tbilisi" })}</td>
              </tr>
            );
          })}</tbody>
        </table></div></div>
      )}
    </>
  );
}
