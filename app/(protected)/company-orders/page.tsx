import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { BUCKET } from "@/lib/supplier-portal";
import { lineProfit, lineTotals, paymentSummary, profitSummary } from "@/lib/company-orders";
import { loadCosts, photoUrlsFor } from "@/lib/company-order-data";
import { balanceTone } from "@/lib/orders";
import Link from "next/link";
import { createCompanyOrderAction, setCompanyOrderStatusById, setProposalHandledById } from "@/app/company-actions";

export const dynamic = "force-dynamic";

const fmt = (value: number) => value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS: Record<string, { label: string; badge: string }> = {
  new: { label: "New", badge: "warning" }, accepted: { label: "Accepted", badge: "success" }, cancelled: { label: "Cancelled", badge: "danger" }
};
const when = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Tbilisi", dateStyle: "medium", timeStyle: "short" });

export default async function CompanyOrdersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: pageError } = await searchParams;
  await requireSourcingAccess();
  const db = adminDb();
  const itemColumns = (prepared: boolean) => `sourcing_company_order_items(id,sku,product_id,product_name,quantity,unit_price,currency${prepared ? ",prepared_at" : ""})`;
  const orderColumns = (prepared: boolean, payments: boolean) =>
    `id,order_no,status,note,created_at,sourcing_companies(name),${itemColumns(prepared)}${payments ? ",sourcing_company_payments(amount,currency,status)" : ""}`;
  const loadOrders = (prepared: boolean, payments: boolean) => db.from("sourcing_company_orders").select(orderColumns(prepared, payments))
    .order("created_at", { ascending: false }).limit(200);
  const [companiesResult, firstOrdersResult, proposalsResult] = await Promise.all([
    db.from("sourcing_companies").select("id,name").order("name"),
    loadOrders(true, true),
    db.from("sourcing_company_proposals")
      .select("id,name,description,link,quantity,status,created_at,sourcing_companies(name),sourcing_company_proposal_images(id,object_path)")
      .order("created_at", { ascending: false }).limit(200)
  ]);
  // Until the payments / ready-mark migrations have been run, the orders still load (just without those parts).
  let ordersResult: any = firstOrdersResult;
  for (const [prepared, payments] of [[false, true], [true, false], [false, false]] as [boolean, boolean][]) {
    if (!ordersResult.error) break;
    ordersResult = await loadOrders(prepared, payments);
  }
  if (ordersResult.error || proposalsResult.error) {
    return (
      <>
        <div className="page-head"><div><h1>Company orders</h1></div></div>
        <div className="notice">The company portal is not set up yet. Run supabase/migrations/20261017_company_portal.sql in the Supabase SQL Editor, then reload this page.</div>
      </>
    );
  }
  const companies: any[] = companiesResult.data ?? [];
  const orders: any[] = ordersResult.data ?? [];
  const proposals: any[] = proposalsResult.data ?? [];

  const photoPaths = proposals.flatMap(proposal => (proposal.sourcing_company_proposal_images ?? []).map((image: any) => image.object_path as string));
  const urlByPath = new Map<string, string>();
  if (photoPaths.length) {
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(photoPaths, 3600);
    photoPaths.forEach((path, index) => { if (signed?.[index]?.signedUrl) urlByPath.set(path, signed[index].signedUrl); });
  }
  const allProductIds = orders.flatMap(order => (order.sourcing_company_order_items ?? []).map((item: any) => item.product_id as string | null));
  const [photoUrl, { costOf, costReason, rates }] = await Promise.all([photoUrlsFor(db, allProductIds), loadCosts(db, allProductIds)]);
  const newOrders = orders.filter(order => order.status === "new").length;
  const newProposals = proposals.filter(proposal => proposal.status === "new").length;
  const paymentsToConfirm = orders.reduce((sum, order) => sum + (order.sourcing_company_payments ?? []).filter((payment: any) => payment.status === "pending").length, 0);

  return (
    <>
      <div className="page-head">
        <div><h1>Company orders</h1><div className="muted">Orders and product suggestions sent by your companies</div></div>
        <div className="badges">
          <span className={`badge ${newOrders ? "warning" : ""}`}>{newOrders} new order{newOrders === 1 ? "" : "s"}</span>
          <span className={`badge ${newProposals ? "warning" : ""}`}>{newProposals} new suggestion{newProposals === 1 ? "" : "s"}</span>
          <span className={`badge ${paymentsToConfirm ? "warning" : ""}`}>{paymentsToConfirm} payment{paymentsToConfirm === 1 ? "" : "s"} to confirm</span>
        </div>
      </div>

      {pageError && <div className="notice">{pageError}</div>}
      <details className="card" style={{ marginBottom: 14 }}>
        <summary>+ New order for a company</summary>
        <form action={createCompanyOrderAction} className="form-grid" style={{ marginTop: 12 }}>
          <label>Company *
            <select name="company_id" required defaultValue="">
              <option value="" disabled>Select a company</option>
              {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
            </select>
          </label>
          <label>Note (optional)<input name="note" maxLength={2000} /></label>
          <div><button className="btn" type="submit">Create and add products</button></div>
        </form>
      </details>

      <h2>Orders ({orders.length})</h2>
      {orders.length === 0 ? <div className="card empty" style={{ marginBottom: 20 }}>No orders from companies yet.</div> : (
        <div className="stack" style={{ marginBottom: 24 }}>
          {orders.map(order => {
            const items: any[] = order.sourcing_company_order_items ?? [];
            const totals = lineTotals(items.map(item => ({ quantity: Number(item.quantity), unit_price: item.unit_price === null ? null : Number(item.unit_price), currency: item.currency })));
            const status = STATUS[order.status] ?? STATUS.new;
            const orderPayments: any[] = order.sourcing_company_payments ?? [];
            const summary = paymentSummary(items.map(item => ({ quantity: Number(item.quantity), unit_price: item.unit_price === null ? null : Number(item.unit_price), currency: item.currency })), orderPayments);
            const readyCount = items.filter(item => item.prepared_at).length;
            const profit = profitSummary(items.map(item => ({ quantity: Number(item.quantity), unit_price: item.unit_price === null ? null : Number(item.unit_price), currency: item.currency, costGel: item.product_id ? costOf.get(item.product_id) : null })), rates);
            const toConfirm = orderPayments.filter(payment => payment.status === "pending").length;
            return (
              <details className="card order-fold" key={order.id} open={order.status === "new"}>
                <summary className="order-fold-head">
                  <span className="order-fold-title"><strong>{order.order_no} · {order.sourcing_companies?.name ?? "Company"}</strong>
                    <span className="muted small">{when(order.created_at)} · {items.length} product{items.length === 1 ? "" : "s"} · {totals.totalQuantity.toLocaleString("en-GB")} pcs</span></span>
                  <span className="order-fold-end">
                    <strong>{totals.byCurrency.map(item => `${item.currency} ${fmt(item.total)}`).join(" + ") || "—"}</strong>
                    <span className={`badge ${status.badge}`}>{status.label}</span>
                    {items.length > 0 && <span className={`badge ${readyCount === items.length ? "success" : ""}`}>{readyCount === items.length ? "✓ All ready" : `${readyCount} of ${items.length} ready`}</span>}
                    {profit.counted > 0 && <span className={`badge ${profit.profit >= 0 ? "success" : "danger"}`} title="Sell price minus landed cost, in GEL">Profit GEL {fmt(profit.profit)}</span>}
                    {summary.map(row => {
                      const tone = balanceTone(row);
                      return <span key={row.currency} className={`balance-pill ${tone}`}>{tone === "paid" ? `✓ ${row.currency} paid` : tone === "over" ? `▲ ${row.currency} ${fmt(Math.abs(row.balance))} over` : `${row.currency} ${fmt(row.balance)} to pay`}</span>;
                    })}
                    {toConfirm > 0 && <span className="badge warning">{toConfirm} payment{toConfirm === 1 ? "" : "s"} to confirm</span>}
                  </span>
                </summary>
                <div className="table-wrap order-table"><table>
                  <thead><tr><th></th><th>Code</th><th>Product</th><th>Quantity</th><th>Sell price</th><th>Total</th><th>Profit (GEL)</th><th>Ready</th></tr></thead>
                  <tbody>{items.map(item => (
                    <tr key={item.id}>
                      <td className="thumb-cell">{item.product_id && photoUrl.get(item.product_id)
                        ? <a href={photoUrl.get(item.product_id)} target="_blank" rel="noopener noreferrer"><img className="order-thumb" src={photoUrl.get(item.product_id)} alt={item.product_name} loading="lazy" /></a>
                        : <div className="order-thumb empty">—</div>}</td>
                      <td className="code-cell">{item.sku ?? "—"}</td><td>{item.product_name}</td>
                      <td>{Number(item.quantity).toLocaleString("en-GB")}</td>
                      <td>{item.unit_price === null ? <span className="muted">no price</span> : `${item.currency} ${fmt(Number(item.unit_price))}`}</td>
                      <td className="num">{item.unit_price === null ? "—" : `${item.currency} ${fmt(Number(item.quantity) * Number(item.unit_price))}`}</td>
                      <td className="num">{(() => {
                        const result = lineProfit({ quantity: Number(item.quantity), unit_price: item.unit_price === null ? null : Number(item.unit_price), currency: item.currency }, item.product_id ? costOf.get(item.product_id) : null, rates);
                        return result ? <span title={`Cost GEL ${fmt(result.cost)}`} style={{ color: result.profit < 0 ? "var(--danger, #b42318)" : undefined }}>{fmt(result.profit)}</span>
                          : <span className="muted small">{item.unit_price === null ? "no sell price" : !item.product_id ? "product removed" : costReason.get(item.product_id) ?? "—"}</span>;
                      })()}</td>
                      <td>{item.prepared_at ? <span className="badge success">✓ Ready</span> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}</tbody>
                  <tfoot><tr>
                    <td colSpan={3}><strong>Total</strong></td>
                    <td><strong>{totals.totalQuantity.toLocaleString("en-GB")}</strong></td>
                    <td></td>
                    <td className="num"><strong>{totals.byCurrency.map(item => `${item.currency} ${fmt(item.total)}`).join(" + ") || "—"}</strong></td>
                    <td className="num"><strong>{profit.counted > 0 ? fmt(profit.profit) : "—"}</strong></td>
                    <td><strong>{readyCount}/{items.length}</strong></td>
                  </tr></tfoot>
                </table></div>
                {profit.counted > 0 && (
                  <p className="small" style={{ margin: "8px 0 0" }}>
                    <strong>Profit (GEL):</strong> revenue {fmt(profit.revenue)} − cost {fmt(profit.cost)} = <strong>{fmt(profit.profit)}</strong>
                    {profit.revenue > 0 && <span className="muted"> ({fmt(profit.profit / profit.revenue * 100)}% of revenue)</span>}
                    {profit.skipped > 0 && <span className="muted"> · {profit.skipped} line{profit.skipped === 1 ? "" : "s"} not counted</span>}
                  </p>
                )}
                {order.note && <p className="small"><strong>Company note:</strong> {order.note}</p>}
                <div className="product-actions" style={{ marginTop: 10 }}>
                  <Link className="btn secondary sm" href={`/company-orders/${order.id}`}>Edit</Link>
                  {order.status !== "accepted" && <form action={setCompanyOrderStatusById.bind(null, order.id, "accepted")}><button className="btn sm" type="submit">Accept</button></form>}
                  {order.status !== "cancelled" && <form action={setCompanyOrderStatusById.bind(null, order.id, "cancelled")}><button className="btn danger sm" type="submit">Cancel</button></form>}
                  {order.status !== "new" && <form action={setCompanyOrderStatusById.bind(null, order.id, "new")}><button className="btn secondary sm" type="submit">Back to new</button></form>}
                </div>
              </details>
            );
          })}
        </div>
      )}

      <h2>Product suggestions ({proposals.length})</h2>
      {proposals.length === 0 ? <div className="card empty">No suggestions yet.</div> : (
        <div className="stack">
          {proposals.map(proposal => {
            const photos: any[] = proposal.sourcing_company_proposal_images ?? [];
            return (
              <div className="card" key={proposal.id}>
                <div className="badges">
                  <span className="badge">{proposal.sourcing_companies?.name ?? "Company"}</span>
                  <span className={`badge ${proposal.status === "handled" ? "success" : "warning"}`}>{proposal.status === "handled" ? "Handled" : "New"}</span>
                  <span className="small muted">{when(proposal.created_at)}</span>
                </div>
                <div className="product-title" style={{ marginTop: 8 }}>{proposal.name}{proposal.quantity ? <span className="muted small"> · wants {Number(proposal.quantity).toLocaleString("en-GB")} pcs</span> : null}</div>
                {proposal.description && <p className="product-text" style={{ whiteSpace: "pre-wrap" }}>{proposal.description}</p>}
                {proposal.link && <p className="small"><a href={proposal.link} target="_blank" rel="noopener noreferrer nofollow">{proposal.link}</a></p>}
                {photos.length > 0 && <div className="badges">{photos.map(photo => urlByPath.get(photo.object_path)
                  ? <a key={photo.id} href={urlByPath.get(photo.object_path)} target="_blank" rel="noopener noreferrer"><img className="order-thumb" src={urlByPath.get(photo.object_path)} alt={proposal.name} /></a> : null)}</div>}
                <div className="product-actions" style={{ marginTop: 10 }}>
                  <form action={setProposalHandledById.bind(null, proposal.id, proposal.status !== "handled")}>
                    <button className="btn secondary sm" type="submit">{proposal.status === "handled" ? "Mark as new" : "Mark as handled"}</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
