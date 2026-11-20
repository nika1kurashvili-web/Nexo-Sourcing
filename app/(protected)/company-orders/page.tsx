import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { BUCKET } from "@/lib/supplier-portal";
import { lineTotals } from "@/lib/company-orders";
import { setCompanyOrderStatusById, setProposalHandledById } from "@/app/company-actions";

export const dynamic = "force-dynamic";

const fmt = (value: number) => value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS: Record<string, { label: string; badge: string }> = {
  new: { label: "New", badge: "warning" }, accepted: { label: "Accepted", badge: "success" }, cancelled: { label: "Cancelled", badge: "danger" }
};
const when = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Tbilisi", dateStyle: "medium", timeStyle: "short" });

export default async function CompanyOrdersPage() {
  await requireSourcingAccess();
  const db = adminDb();
  const [ordersResult, proposalsResult] = await Promise.all([
    db.from("sourcing_company_orders")
      .select("id,order_no,status,note,created_at,sourcing_companies(name),sourcing_company_order_items(id,sku,product_name,quantity,unit_price,currency)")
      .order("created_at", { ascending: false }).limit(200),
    db.from("sourcing_company_proposals")
      .select("id,name,description,link,quantity,status,created_at,sourcing_companies(name),sourcing_company_proposal_images(id,object_path)")
      .order("created_at", { ascending: false }).limit(200)
  ]);
  if (ordersResult.error || proposalsResult.error) {
    return (
      <>
        <div className="page-head"><div><h1>Company orders</h1></div></div>
        <div className="notice">The company portal is not set up yet. Run supabase/migrations/20261017_company_portal.sql in the Supabase SQL Editor, then reload this page.</div>
      </>
    );
  }
  const orders: any[] = ordersResult.data ?? [];
  const proposals: any[] = proposalsResult.data ?? [];

  const photoPaths = proposals.flatMap(proposal => (proposal.sourcing_company_proposal_images ?? []).map((image: any) => image.object_path as string));
  const urlByPath = new Map<string, string>();
  if (photoPaths.length) {
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(photoPaths, 3600);
    photoPaths.forEach((path, index) => { if (signed?.[index]?.signedUrl) urlByPath.set(path, signed[index].signedUrl); });
  }
  const newOrders = orders.filter(order => order.status === "new").length;
  const newProposals = proposals.filter(proposal => proposal.status === "new").length;

  return (
    <>
      <div className="page-head">
        <div><h1>Company orders</h1><div className="muted">Orders and product suggestions sent by your companies</div></div>
        <div className="badges">
          <span className={`badge ${newOrders ? "warning" : ""}`}>{newOrders} new order{newOrders === 1 ? "" : "s"}</span>
          <span className={`badge ${newProposals ? "warning" : ""}`}>{newProposals} new suggestion{newProposals === 1 ? "" : "s"}</span>
        </div>
      </div>

      <h2>Orders ({orders.length})</h2>
      {orders.length === 0 ? <div className="card empty" style={{ marginBottom: 20 }}>No orders from companies yet.</div> : (
        <div className="stack" style={{ marginBottom: 24 }}>
          {orders.map(order => {
            const items: any[] = order.sourcing_company_order_items ?? [];
            const totals = lineTotals(items.map(item => ({ quantity: Number(item.quantity), unit_price: item.unit_price === null ? null : Number(item.unit_price), currency: item.currency })));
            const status = STATUS[order.status] ?? STATUS.new;
            return (
              <details className="card order-fold" key={order.id} open={order.status === "new"}>
                <summary className="order-fold-head">
                  <span className="order-fold-title"><strong>{order.order_no} · {order.sourcing_companies?.name ?? "Company"}</strong>
                    <span className="muted small">{when(order.created_at)} · {items.length} product{items.length === 1 ? "" : "s"} · {totals.totalQuantity.toLocaleString("en-GB")} pcs</span></span>
                  <span className="order-fold-end">
                    <strong>{totals.byCurrency.map(item => `${item.currency} ${fmt(item.total)}`).join(" + ") || "—"}</strong>
                    <span className={`badge ${status.badge}`}>{status.label}</span>
                  </span>
                </summary>
                <div className="table-wrap order-table"><table>
                  <thead><tr><th>Code</th><th>Product</th><th>Quantity</th><th>Sell price</th><th>Total</th></tr></thead>
                  <tbody>{items.map(item => (
                    <tr key={item.id}>
                      <td className="code-cell">{item.sku ?? "—"}</td><td>{item.product_name}</td>
                      <td>{Number(item.quantity).toLocaleString("en-GB")}</td>
                      <td>{item.unit_price === null ? <span className="muted">no price</span> : `${item.currency} ${fmt(Number(item.unit_price))}`}</td>
                      <td className="num">{item.unit_price === null ? "—" : `${item.currency} ${fmt(Number(item.quantity) * Number(item.unit_price))}`}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
                {order.note && <p className="small"><strong>Company note:</strong> {order.note}</p>}
                <div className="product-actions" style={{ marginTop: 10 }}>
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
