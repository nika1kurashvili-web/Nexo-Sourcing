import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { PAYMENT_METHODS, lineProfit, lineTotals, paymentMethodLabel, paymentSummary, profitSummary } from "@/lib/company-orders";
import { balanceTone } from "@/lib/orders";
import { BUCKET } from "@/lib/supplier-portal";
import { COST_DEFAULTS, COST_FIELDS, SHIPPING_METHODS, computeCost, settingKey, type CostSettings } from "@/lib/landed-cost";
import { ConfirmButton } from "@/components/ConfirmButton";
import { LineSearch } from "@/components/LineSearch";
import {
  addCompanyOrderItemsAction, addCompanyPaymentAction, confirmCompanyPaymentById, deleteCompanyOrderById, deleteCompanyPaymentById, removeCompanyOrderItemById, saveCompanyOrderAction, setCompanyAllReadyById, setCompanyItemReadyById, setCompanyOrderStatusById
} from "@/app/company-actions";

export const dynamic = "force-dynamic";

const fmt = (value: number) => value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS: Record<string, { label: string; badge: string }> = {
  new: { label: "New", badge: "warning" }, accepted: { label: "Accepted", badge: "success" }, cancelled: { label: "Cancelled", badge: "danger" }
};

// First ready photo of each product as a short-lived signed link (staff only), in two round trips.
async function photoUrlsFor(db: any, productIds: (string | null)[]) {
  const urls = new Map<string, string>();
  const ids = Array.from(new Set(productIds.filter((value): value is string => !!value)));
  if (!ids.length) return urls;
  const { data: photos } = await db.from("sourcing_product_images").select("product_id,object_path,created_at")
    .eq("ready", true).in("product_id", ids).order("created_at");
  const firstPerProduct = new Map<string, string>();
  for (const photo of photos ?? []) if (!firstPerProduct.has(photo.product_id)) firstPerProduct.set(photo.product_id, photo.object_path);
  const paths = Array.from(firstPerProduct.values());
  if (!paths.length) return urls;
  const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths, 3600);
  const urlByPath = new Map<string, string>();
  paths.forEach((path, index) => { if (signed?.[index]?.signedUrl) urlByPath.set(path, signed[index].signedUrl); });
  firstPerProduct.forEach((path, productId) => { const url = urlByPath.get(path); if (url) urls.set(productId, url); });
  return urls;
}

export default async function EditCompanyOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  await requireSourcingAccess();
  if (!UUID_PATTERN.test(id)) notFound();
  const db = adminDb();
  const paymentsPart = ",sourcing_company_payments(id,paid_on,amount,currency,method,note,status,entered_by,created_at)";
  const orderColumns = (prepared: boolean) => `id,company_id,order_no,status,note,created_at,sourcing_companies(name),sourcing_company_order_items(id,product_id,sku,product_name,quantity,unit_price,currency,created_at${prepared ? ",prepared_at" : ""})`;
  // Until the payments / ready-mark migrations have been run, the order still opens (without those parts).
  let paymentsReady = true;
  let orderResult: any = null;
  for (const [prepared, withPayments] of [[true, true], [false, true], [true, false], [false, false]] as [boolean, boolean][]) {
    orderResult = await db.from("sourcing_company_orders").select(orderColumns(prepared) + (withPayments ? paymentsPart : "")).eq("id", id).maybeSingle();
    if (!orderResult.error) { paymentsReady = withPayments; break; }
  }
  const order = orderResult.data;
  if (!order) notFound();
  const items: any[] = [...(order.sourcing_company_order_items ?? [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  const productIds = Array.from(new Set(items.map(item => item.product_id).filter(Boolean))) as string[];
  const [photoUrl, costResult, settingsResult] = await Promise.all([
    photoUrlsFor(db, items.map(item => item.product_id)),
    productIds.length
      ? db.from("sourcing_products").select("id,price,currency,shipping_method,qty_in_box,weight_kg,box_length_cm,box_width_cm,box_height_cm").in("id", productIds)
      : Promise.resolve({ data: [] as any[] }),
    db.from("sourcing_settings").select("key,value")
  ]);
  // Staff-only: landed cost per piece in GEL (same numbers as the Products page; land-transport rates unless a product is marked air).
  const costSettings: CostSettings = { land: { ...COST_DEFAULTS.land }, air: { ...COST_DEFAULTS.air } };
  const stored = new Map<string, number>(((settingsResult as any).data ?? []).map((row: any) => [row.key as string, Number(row.value)]));
  for (const method of SHIPPING_METHODS) for (const field of COST_FIELDS) {
    const value = stored.get(settingKey(method.value, field.key));
    if (value !== undefined && Number.isFinite(value)) costSettings[method.value][field.key] = value;
  }
  const rates = { usd_gel: costSettings.land.usd_gel, cny_per_gel: costSettings.land.cny_per_gel };
  const costOf = new Map<string, number | null>(((costResult as any).data ?? []).map((row: any) => {
    const result = computeCost(row, costSettings);
    return [row.id as string, result.ok ? result.total : null];
  }));
  const profit = profitSummary(items.map(item => ({ quantity: Number(item.quantity), unit_price: item.unit_price === null ? null : Number(item.unit_price), currency: item.currency, costGel: item.product_id ? costOf.get(item.product_id) : null })), rates);

  const { data: assigned } = await db.from("sourcing_company_products")
    .select("product_id,sell_price,currency,sourcing_products!inner(id,sku,name,status)")
    .eq("company_id", order.company_id).eq("sourcing_products.status", "approved").range(0, 999);
  const inOrder = new Set(items.map(item => item.product_id).filter(Boolean));
  const addable: any[] = (assigned ?? []).filter((row: any) => !inOrder.has(row.product_id))
    .sort((a: any, b: any) => String(a.sourcing_products.name).localeCompare(String(b.sourcing_products.name)));
  // Photos for the "add products" list too (only when the list is short enough to stay fast).
  if (addable.length <= 40) {
    const more = await photoUrlsFor(db, addable.map((row: any) => row.product_id).filter((productId: string) => !photoUrl.has(productId)));
    more.forEach((url, productId) => photoUrl.set(productId, url));
  }

  const totals = lineTotals(items.map(item => ({ quantity: Number(item.quantity), unit_price: item.unit_price === null ? null : Number(item.unit_price), currency: item.currency })));
  const status = STATUS[order.status] ?? STATUS.new;
  const payments: any[] = [...(order.sourcing_company_payments ?? [])].sort((a, b) => String(a.paid_on).localeCompare(String(b.paid_on)) || String(a.created_at).localeCompare(String(b.created_at)));
  const summary = paymentSummary(items.map(item => ({ quantity: Number(item.quantity), unit_price: item.unit_price === null ? null : Number(item.unit_price), currency: item.currency })), payments);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tbilisi" });
  const preparedCount = items.filter(item => item.prepared_at).length;
  const waiting = payments.filter(payment => payment.status === "pending").length;
  const currencyOptions = Array.from(new Set([...items.map(item => item.currency as string), "GEL", "USD", "EUR", "CNY"]));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{order.order_no}</h1>
          <div className="muted">{order.sourcing_companies?.name ?? "Company"} · <Link href="/company-orders">All company orders</Link></div>
        </div>
        <div className="badges">
          <span className={`badge ${status.badge}`}>{status.label}</span>
          <span className="badge">{items.length} product{items.length === 1 ? "" : "s"} · {totals.totalQuantity.toLocaleString("en-GB")} pcs</span>
          <span className="badge">{totals.byCurrency.map(item => `${item.currency} ${fmt(item.total)}`).join(" + ") || "No prices"}</span>
          {profit.counted > 0 && <span className={`badge ${profit.profit >= 0 ? "success" : "danger"}`} title="Sell price minus landed cost, in GEL">Profit GEL {fmt(profit.profit)}</span>}
          {summary.map(row => {
            const tone = balanceTone(row);
            return <span key={row.currency} className={`balance-pill ${tone}`}>{tone === "paid" ? `✓ ${row.currency} paid in full` : tone === "over" ? `▲ ${row.currency} ${fmt(Math.abs(row.balance))} over` : `${row.currency} ${fmt(row.balance)} to pay`}</span>;
          })}
          {waiting > 0 && <span className="badge warning">{waiting} payment{waiting === 1 ? "" : "s"} to confirm</span>}
        </div>
      </div>
      {error && <div className="notice">{error}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="product-actions">
          {order.status !== "accepted" && <form action={setCompanyOrderStatusById.bind(null, order.id, "accepted")}><button className="btn" type="submit">Accept</button></form>}
          {order.status !== "cancelled" && <form action={setCompanyOrderStatusById.bind(null, order.id, "cancelled")}><button className="btn danger" type="submit">Cancel</button></form>}
          {order.status !== "new" && <form action={setCompanyOrderStatusById.bind(null, order.id, "new")}><button className="btn secondary" type="submit">Back to new</button></form>}
          <form action={deleteCompanyOrderById.bind(null, order.id)}>
            <ConfirmButton message="Delete this order permanently? The company will no longer see it." className="btn danger">Delete order</ConfirmButton>
          </form>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Everything you change here is what the company sees in "My orders".</p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0 }}>Products <span className="muted small" style={{ fontWeight: 500 }}>· {items.length}</span></h2>
        {items.length === 0 ? <div className="empty">No products yet. Add some below.</div> : (
          <form action={saveCompanyOrderAction.bind(null, order.id)}>
            {/* Enter inside a field must save, never remove a line: this is the first (default) submit button. */}
            <button type="submit" tabIndex={-1} aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}>Save</button>
            <LineSearch><div className="table-wrap order-table"><table>
              <thead><tr><th></th><th>Code</th><th>Product</th><th>Quantity</th><th>Price</th><th>Currency</th><th>Line total</th><th>Profit</th><th>Ready</th><th></th></tr></thead>
              <tbody>{items.map(item => (
                <tr key={item.id}>
                  <td className="thumb-cell">{item.product_id && photoUrl.get(item.product_id)
                    ? <a href={photoUrl.get(item.product_id)} target="_blank" rel="noopener noreferrer"><img className="order-thumb" src={photoUrl.get(item.product_id)} alt={item.product_name} loading="lazy" /></a>
                    : <div className="order-thumb empty">—</div>}</td>
                  <td className="code-cell">{item.sku ?? "—"}</td>
                  <td>{item.product_name}{item.product_id === null && <div className="small muted">removed from catalog</div>}</td>
                  <td><input type="number" name={`qty_${item.id}`} defaultValue={Number(item.quantity)} min="0.01" step="any" style={{ width: 84 }} /></td>
                  <td><input type="number" name={`price_${item.id}`} defaultValue={item.unit_price === null ? "" : Number(item.unit_price)} min="0" step="any" style={{ width: 96 }} /></td>
                  <td><select name={`cur_${item.id}`} defaultValue={item.currency}>{["GEL", "USD", "EUR", "CNY"].map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></td>
                  <td className="num"><strong>{item.unit_price === null ? <span className="muted">no price</span> : `${item.currency} ${fmt(Number(item.quantity) * Number(item.unit_price))}`}</strong></td>
                  <td className="num">{(() => {
                    const result = lineProfit({ quantity: Number(item.quantity), unit_price: item.unit_price === null ? null : Number(item.unit_price), currency: item.currency }, item.product_id ? costOf.get(item.product_id) : null, rates);
                    return result ? <span title={`Cost GEL ${fmt(result.cost)}`} style={{ color: result.profit < 0 ? "var(--danger, #b42318)" : undefined }}>{fmt(result.profit)}</span> : <span className="muted">—</span>;
                  })()}</td>
                  <td><div className="product-actions">
                    {item.prepared_at ? <span className="badge success" title={new Date(item.prepared_at).toLocaleString("en-GB", { timeZone: "Asia/Tbilisi" })}>✓ Ready</span> : <span className="muted">—</span>}
                    {order.status !== "cancelled" && (item.prepared_at
                      ? <button className="btn secondary sm" type="submit" formAction={setCompanyItemReadyById.bind(null, order.id, item.id, false)}>Undo</button>
                      : <button className="btn sm" type="submit" formAction={setCompanyItemReadyById.bind(null, order.id, item.id, true)}>Mark ready</button>)}
                  </div></td>
                  <td><button className="btn danger sm" type="submit" formAction={removeCompanyOrderItemById.bind(null, order.id, item.id)} title="Remove from order">Remove</button></td>
                </tr>
              ))}</tbody>
            </table></div></LineSearch>
            <label style={{ marginTop: 12, display: "block" }}>Note
              <textarea name="note" defaultValue={order.note ?? ""} maxLength={2000} rows={2} />
            </label>
            {profit.counted > 0 && (
              <p className="small muted" style={{ marginBottom: 0 }}>
                Profit (GEL, only you see this) = sell price minus landed cost per piece. Sell prices in USD/CNY are converted with the land-transport rates (USD × {rates.usd_gel}, CNY ÷ {rates.cny_per_gel}).
                {" "}Total: revenue {fmt(profit.revenue)}, cost {fmt(profit.cost)}, profit {fmt(profit.profit)}
                {profit.skipped > 0 && ` · ${profit.skipped} line${profit.skipped === 1 ? "" : "s"} not counted (no sell price, or the landed cost cannot be computed: set price, box quantity and box size or weight on the product).`}
              </p>
            )}
            {profit.counted === 0 && items.length > 0 && <p className="small muted" style={{ marginBottom: 0 }}>Profit is not shown yet: no line has both a sell price and a computable landed cost (set price, box quantity and box size or weight on the products).</p>}
            <div className="product-actions" style={{ marginTop: 12 }}>
              <button className="btn" type="submit">Save changes</button>
              <span className="muted small">{preparedCount} of {items.length} ready</span>
              <button className="btn secondary sm" type="submit" formAction={setCompanyAllReadyById.bind(null, order.id, true)} disabled={preparedCount === items.length || order.status === "cancelled"}>Mark all ready</button>
              <button className="btn secondary sm" type="submit" formAction={setCompanyAllReadyById.bind(null, order.id, false)} disabled={preparedCount === 0}>Clear all marks</button>
            </div>
          </form>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <h2 style={{ marginTop: 0 }}>Payments</h2>
        {!paymentsReady && <div className="notice">Run supabase/migrations/20261018_company_payments.sql in the Supabase SQL Editor to record payments.</div>}
        {summary.length > 0 && (
          <div className="table-wrap"><table>
            <thead><tr><th>Currency</th><th>Order total</th><th>Paid (confirmed)</th><th>Waiting for confirmation</th><th>Balance</th></tr></thead>
            <tbody>{summary.map(row => (
              <tr key={row.currency}><td>{row.currency}</td><td className="num">{fmt(row.total)}</td><td className="num">{fmt(row.paid)}</td>
                <td className="num">{row.pending ? fmt(row.pending) : "—"}</td><td className="num"><strong>{fmt(row.balance)}</strong></td></tr>
            ))}</tbody>
          </table></div>
        )}
        {payments.length === 0 ? <div className="empty">No payments recorded.</div> : (
          <div className="table-wrap" style={{ marginTop: 10 }}><table>
            <thead><tr><th>Date</th><th>Amount</th><th>How</th><th>Note</th><th>Recorded by</th><th>Status</th><th></th></tr></thead>
            <tbody>{payments.map(payment => (
              <tr key={payment.id}>
                <td>{payment.paid_on}</td>
                <td className="num">{payment.currency} {fmt(Number(payment.amount))}</td>
                <td>{paymentMethodLabel(payment.method)}</td>
                <td>{payment.note ?? "—"}</td>
                <td>{payment.entered_by === "company" ? "Company" : "You"}</td>
                <td><span className={`badge ${payment.status === "confirmed" ? "success" : "warning"}`}>{payment.status === "confirmed" ? "Confirmed" : "Waiting for you"}</span></td>
                <td><div className="product-actions">
                  {payment.status === "pending" && <form action={confirmCompanyPaymentById.bind(null, order.id, payment.id)}><button className="btn sm" type="submit">Confirm</button></form>}
                  <form action={deleteCompanyPaymentById.bind(null, order.id, payment.id)}>
                    <ConfirmButton message={payment.status === "pending" ? "Reject this payment? It will be removed." : "Delete this payment record?"} className="btn danger sm">{payment.status === "pending" ? "Reject" : "Delete"}</ConfirmButton>
                  </form>
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <form action={addCompanyPaymentAction.bind(null, order.id)} className="form-grid four" style={{ marginTop: 14 }}>
          <label>Date<input type="date" name="paid_on" defaultValue={today} required /></label>
          <label>Amount<input type="number" name="amount" min="0.01" step="any" required /></label>
          <label>Currency<select name="currency" defaultValue={currencyOptions[0]}>{currencyOptions.map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></label>
          <label>Paid by<select name="method" defaultValue="transfer">{PAYMENT_METHODS.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
          <label style={{ gridColumn: "1 / -1" }}>Note<input name="note" maxLength={1000} placeholder="e.g. transfer reference" /></label>
          <div><button className="btn" type="submit">Record payment</button></div>
        </form>
      </div>

      <details className="card" open={items.length === 0}>
        <summary>+ Add products ({addable.length} available for this company)</summary>
        {addable.length === 0 ? <div className="muted" style={{ marginTop: 10 }}>No more products are marked for this company. Mark products in Products → "Companies &amp; sell price".</div> : (
          <form action={addCompanyOrderItemsAction.bind(null, order.id)} style={{ marginTop: 12 }}>
            <LineSearch><div className="table-wrap order-table"><table>
              <thead><tr><th></th><th>Code</th><th>Product</th><th>Sell price</th><th>Quantity</th></tr></thead>
              <tbody>{addable.map((row: any) => (
                <tr key={row.product_id}>
                  <td className="thumb-cell">{photoUrl.get(row.product_id)
                    ? <a href={photoUrl.get(row.product_id)} target="_blank" rel="noopener noreferrer"><img className="order-thumb" src={photoUrl.get(row.product_id)} alt={row.sourcing_products.name} loading="lazy" /></a>
                    : <div className="order-thumb empty">—</div>}</td>
                  <td className="code-cell">{row.sourcing_products.sku ?? "—"}</td>
                  <td>{row.sourcing_products.name}</td>
                  <td>{row.sell_price === null ? <span className="muted">no price</span> : `${row.currency} ${fmt(Number(row.sell_price))}`}</td>
                  <td><input type="number" name={`add_${row.product_id}`} min="0.01" step="any" placeholder="0" style={{ width: 84 }} /></td>
                </tr>
              ))}</tbody>
            </table></div></LineSearch>
            <div style={{ marginTop: 12 }}><button className="btn" type="submit">Add the typed quantities</button></div>
          </form>
        )}
      </details>
    </>
  );
}
