import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import {
  addOrderItemsAction, addPaymentAction, approveProposalAction, deleteOrderAction, deletePaymentAction,
  rejectProposalAction, removeOrderItemAction, saveOrderItemsAction, setOrderStatusAction, updateOrderNoteAction
} from "@/app/order-actions";
import { STATUS_LABELS, lineTotal, money, orderTotals, type OrderStatus } from "@/lib/orders";
import { ConfirmButton } from "@/components/ConfirmButton";
import { LineSearch } from "@/components/LineSearch";
import { BUCKET } from "@/lib/supplier-portal";
import { OrderProductPicker } from "@/components/OrderProductPicker";

export const dynamic = "force-dynamic";

const BADGE: Record<string, string> = { draft: "", sent: "warning", confirmed: "success", cancelled: "danger" };

function StatusButton({ orderId, to, label, confirm, secondary }: { orderId: string; to: string; label: string; confirm?: string; secondary?: boolean }) {
  return (
    <form action={setOrderStatusAction}>
      <input type="hidden" name="order_id" value={orderId} /><input type="hidden" name="to" value={to} />
      {confirm ? <ConfirmButton message={confirm} className={secondary ? "btn secondary" : "btn"}>{label}</ConfirmButton>
        : <button className={secondary ? "btn secondary" : "btn"} type="submit">{label}</button>}
    </form>
  );
}

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  await requireSourcingAccess();
  if (!UUID_PATTERN.test(id)) notFound();
  const db = adminDb();

  const [orderResult, itemsResult, paymentsResult] = await Promise.all([
    db.from("sourcing_orders").select("*, sourcing_suppliers(name)").eq("id", id).maybeSingle(),
    db.from("sourcing_order_items").select("*").eq("order_id", id).order("created_at"),
    db.from("sourcing_order_payments").select("*").eq("order_id", id).order("paid_on").order("created_at")
  ]);
  const order = orderResult.data;
  if (!order) notFound();
  const items: any[] = itemsResult.data ?? [];
  const payments: any[] = paymentsResult.data ?? [];
  const status = order.status as OrderStatus;
  const editable = status === "draft" || status === "sent";
  const totals = orderTotals(items, payments.map(payment => payment.amount));
  const preparedCount = items.filter(item => item.prepared_at).length;

  // Products that can still be added (approved products of this supplier).
  const productsResult = editable
    ? await db.from("sourcing_products").select("id,sku,name,price,currency").eq("supplier_id", order.supplier_id).eq("status", "approved").order("name").limit(2000)
    : { data: [] };
  // One photo per product (shown small; click opens it). Signed links are short-lived and made for staff only.
  const wanted = Array.from(new Set([...items.map(item => item.product_id), ...(productsResult.data ?? []).map((product: any) => product.id)].filter(Boolean)));
  const photoUrl = new Map<string, string>();
  if (wanted.length) {
    const { data: photos } = await db.from("sourcing_product_images").select("product_id,object_path,approved,created_at")
      .eq("ready", true).in("product_id", wanted).order("created_at");
    const firstPerProduct = new Map<string, string>();
    for (const photo of photos ?? []) if (!firstPerProduct.has(photo.product_id)) firstPerProduct.set(photo.product_id, photo.object_path);
    const paths = Array.from(firstPerProduct.values());
    if (paths.length) {
      const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths, 3600);
      const urlByPath = new Map<string, string>();
      paths.forEach((path, index) => { if (signed?.[index]?.signedUrl) urlByPath.set(path, signed[index].signedUrl); });
      firstPerProduct.forEach((path, productId) => { const url = urlByPath.get(path); if (url) photoUrl.set(productId, url); });
    }
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tbilisi" });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{order.order_no}</h1>
          <div className="muted">{order.sourcing_suppliers?.name ?? "Supplier"} · {order.currency} · <Link href="/orders">All orders</Link></div>
        </div>
        <div className="badges">
          <a className="btn secondary" href={`/orders/${id}/export`}>⬇ Download Excel</a>
          <span className={`badge ${BADGE[status] ?? ""}`}>{STATUS_LABELS[status]}</span>
          {items.length > 0 && <span className={`badge ${preparedCount === items.length ? "success" : ""}`}>Prepared {preparedCount} of {items.length}</span>}
        </div>
      </div>
      {error && <div className="notice">{error}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="product-actions">
          {status === "draft" && <StatusButton orderId={id} to="sent" label="Send to supplier" confirm="Make this order visible to the supplier so they can suggest prices?" />}
          {status === "sent" && <StatusButton orderId={id} to="draft" label="Hide from supplier (back to draft)" secondary />}
          {(status === "draft" || status === "sent") && <StatusButton orderId={id} to="confirmed" label="Confirm order" confirm="Confirm this order? Prices become final until you reopen it." />}
          {status === "confirmed" && <StatusButton orderId={id} to="sent" label="Reopen" confirm="Reopen the order so prices can change again?" secondary />}
          {status !== "cancelled" && <StatusButton orderId={id} to="cancelled" label="Cancel order" confirm="Cancel this order?" secondary />}
          {status === "cancelled" && <StatusButton orderId={id} to="draft" label="Reopen as draft" secondary />}
          {(status === "draft" || status === "cancelled") && payments.length === 0 && (
            <form action={deleteOrderAction}><input type="hidden" name="order_id" value={id} />
              <ConfirmButton message="Delete this order permanently?" className="btn danger">Delete order</ConfirmButton></form>
          )}
        </div>
        {status === "sent" && <p className="small muted" style={{ marginBottom: 0 }}>The supplier sees this order in their catalog link under "Orders" and can suggest prices. Suggestions only count after you approve them.</p>}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0 }}>Products <span className="muted small" style={{ fontWeight: 500 }}>· {items.length}</span></h2>
        {items.length === 0 ? <div className="empty">No products yet. Add some below.</div> : (
          <form action={saveOrderItemsAction}>
            <input type="hidden" name="order_id" value={id} />
            {/* Enter inside a field must save, never approve or remove a line: this is the first (default) submit button. */}
            <button type="submit" tabIndex={-1} aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}>Save</button>
            <LineSearch><div className="table-wrap order-table"><table>
              <thead><tr><th>Photo</th><th>Code</th><th>Product</th><th>Quantity</th><th>Price ({order.currency})</th><th>Supplier suggestion</th><th>Line total</th><th>Prepared</th><th></th></tr></thead>
              <tbody>{items.map(item => {
                const line = lineTotal(item.quantity, item.unit_price);
                return (
                  <tr key={item.id}>
                    <td className="thumb-cell">{item.product_id && photoUrl.get(item.product_id)
                      ? <a href={photoUrl.get(item.product_id)} target="_blank" rel="noopener noreferrer"><img className="order-thumb" src={photoUrl.get(item.product_id)} alt={item.product_name} loading="lazy" /></a>
                      : <div className="order-thumb empty">—</div>}</td>
                    <td className="code-cell">{item.sku ?? "—"}</td>
                    <td>{item.product_name}{item.product_id === null && <div className="small muted">removed from catalog</div>}</td>
                    <td>{editable ? <input type="number" name={`qty_${item.id}`} defaultValue={Number(item.quantity)} min="0.01" step="any" style={{ width: 78 }} />
                      : Number(item.quantity).toLocaleString("en-GB")}
                      {item.proposed_quantity !== null && <div className="small" style={{ color: "#72510a" }}>supplier: <strong>{Number(item.proposed_quantity).toLocaleString("en-GB")}</strong></div>}</td>
                    <td>{editable ? <input type="number" name={`price_${item.id}`} defaultValue={item.unit_price === null ? "" : Number(item.unit_price)} min="0" step="any" style={{ width: 88 }} />
                      : money(item.unit_price, order.currency)}</td>
                    <td>{item.proposed_price === null && item.proposed_quantity === null ? <span className="muted">—</span> : (
                      <div className="stack" style={{ gap: 6 }}>
                        {item.proposed_price !== null && <strong>{money(item.proposed_price, order.currency)}</strong>}
                        {item.proposed_quantity !== null && <span className="small">qty {Number(item.proposed_quantity).toLocaleString("en-GB")}</span>}
                        {editable && <div className="product-actions">
                          <button className="btn sm" type="submit" formAction={approveProposalAction} name="item" value={item.id}>Approve</button>
                          <button className="btn secondary sm" type="submit" formAction={rejectProposalAction} name="item" value={item.id}>Reject</button>
                        </div>}
                      </div>)}</td>
                    <td className="num"><strong>{line === null ? <span className="muted">no price</span> : money(line, order.currency)}</strong></td>
                    <td>{item.prepared_at ? <span className="badge success" title={new Date(item.prepared_at).toLocaleString("en-GB", { timeZone: "Asia/Tbilisi" })}>✓ Ready</span> : <span className="muted">—</span>}</td>
                    <td>{editable && <button className="btn danger sm" type="submit" formAction={removeOrderItemAction} name="item" value={item.id} title="Remove from order">Remove</button>}</td>
                  </tr>
                );
              })}</tbody>
            </table></div></LineSearch>
            {editable && <div className="product-actions" style={{ marginTop: 12 }}>
              <button className="btn" type="submit">Save quantities and prices</button>
              {totals.proposals > 0 && <button className="btn secondary" type="submit" formAction={approveProposalAction}>Approve all suggestions ({totals.proposals}) — updates catalog prices</button>}
            </div>}
          </form>
        )}
      </div>

      <div className="grid-4" style={{ marginBottom: 14 }}>
        <div className="stat"><div className="muted small">Total quantity</div><div className="stat-value" style={{ fontSize: 22 }}>{totals.totalQuantity.toLocaleString("en-GB")} pcs</div>
          <div className="small muted">{items.length} product{items.length === 1 ? "" : "s"}</div></div>
        <div className="stat"><div className="muted small">Total</div><div className="stat-value" style={{ fontSize: 22 }}>{money(totals.total, order.currency)}</div>
          {totals.unpriced > 0 && <div className="small muted">{totals.unpriced} product(s) without an approved price</div>}</div>
        <div className="stat"><div className="muted small">Paid</div><div className="stat-value" style={{ fontSize: 22 }}>{money(totals.paid, order.currency)}</div></div>
        <div className="stat"><div className="muted small">{totals.balance < 0 ? "Overpaid" : "Remaining"}</div>
          <div className="stat-value" style={{ fontSize: 22 }}>{money(Math.abs(totals.balance), order.currency)}</div></div>
        {totals.proposals > 0 && <div className="stat"><div className="muted small">Total if all suggestions approved</div>
          <div className="stat-value" style={{ fontSize: 22 }}>{money(totals.proposedTotal, order.currency)}</div></div>}
      </div>

      {editable && (
        <details className="card" style={{ marginBottom: 14 }} open={items.length === 0}>
          <summary>+ Add products from {order.sourcing_suppliers?.name ?? "the supplier"}'s catalog</summary>
          <div style={{ marginTop: 12 }}>
            {(productsResult.data ?? []).length === 0 ? <div className="muted">This supplier has no approved products yet.</div> : (
              <OrderProductPicker products={(productsResult.data ?? []).map((product: any) => ({ ...product, photo: photoUrl.get(product.id) ?? null }))} inOrder={items.map(item => item.product_id).filter(Boolean)}
                orderId={id} orderCurrency={order.currency} action={addOrderItemsAction} />
            )}
          </div>
        </details>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <h2>Payments</h2>
        {payments.length === 0 ? <div className="empty">No payments recorded.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Amount</th><th>Note</th><th>Remaining after</th><th></th></tr></thead>
            <tbody>{(() => {
              let running = totals.total;
              return payments.map(payment => {
                running = Math.round((running - Number(payment.amount)) * 100) / 100;
                return (
                  <tr key={payment.id}>
                    <td>{payment.paid_on}</td>
                    <td>{money(payment.amount, order.currency)}</td>
                    <td>{payment.note ?? "—"}</td>
                    <td>{money(running, order.currency)}</td>
                    <td><form action={deletePaymentAction}><input type="hidden" name="order_id" value={id} /><input type="hidden" name="payment" value={payment.id} />
                      <ConfirmButton message="Delete this payment record?" className="btn danger">Delete</ConfirmButton></form></td>
                  </tr>
                );
              });
            })()}</tbody>
          </table></div>
        )}
        {status !== "cancelled" && (
          <form action={addPaymentAction} className="form-grid four" style={{ marginTop: 14 }}>
            <input type="hidden" name="order_id" value={id} />
            <label>Date<input type="date" name="paid_on" defaultValue={today} required /></label>
            <label>Amount ({order.currency})<input type="number" name="amount" min="0.01" step="any" required /></label>
            <label>Note<input name="note" maxLength={1000} placeholder="e.g. bank transfer" /></label>
            <div style={{ alignSelf: "end" }}><button className="btn" type="submit">Record payment</button></div>
          </form>
        )}
      </div>

      <div className="card">
        <h2>Note</h2>
        <form action={updateOrderNoteAction} className="form-grid">
          <input type="hidden" name="order_id" value={id} />
          <textarea name="note" maxLength={5000} defaultValue={order.note ?? ""} />
          <div><button className="btn secondary" type="submit">Save note</button></div>
        </form>
        <p className="small muted" style={{ marginBottom: 0 }}>The note is internal; the supplier does not see it.</p>
      </div>
    </>
  );
}
