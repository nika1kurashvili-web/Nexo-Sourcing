import { INVALID_COMPANY_LINK, readCompanyOrders } from "@/lib/company-portal";
import { lineTotals } from "@/lib/company-orders";
import { CompanySession } from "@/components/CompanySession";
import { CompanyNav } from "@/components/CompanyNav";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const fmt = (value: number) => value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS: Record<string, { label: string; badge: string }> = {
  new: { label: "Sent to Nexo", badge: "warning" }, accepted: { label: "Accepted", badge: "success" }, cancelled: { label: "Cancelled", badge: "danger" }
};

export default async function CompanyOrdersPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data;
  try { data = await readCompanyOrders(token); }
  catch { return <p className="card">{INVALID_COMPANY_LINK}</p>; }
  return (
    <CompanySession token={token}>
      <CompanyNav token={token} active="orders" companyName={data.companyName} />
      {data.orders.length === 0 ? <div className="card empty">You have not sent any orders yet.</div> : (
        <div className="stack">
          {data.orders.map(order => {
            const items: any[] = order.sourcing_company_order_items ?? [];
            const totals = lineTotals(items.map(item => ({ quantity: Number(item.quantity), unit_price: item.unit_price === null ? null : Number(item.unit_price), currency: item.currency })));
            const status = STATUS[order.status] ?? STATUS.new;
            return (
              <details className="card order-fold" key={order.id}>
                <summary className="order-fold-head">
                  <span className="order-fold-title"><strong>{order.order_no}</strong>
                    <span className="muted small">{new Date(order.created_at).toLocaleDateString("en-GB", { timeZone: "Asia/Tbilisi" })} · {items.length} product{items.length === 1 ? "" : "s"} · {totals.totalQuantity.toLocaleString("en-GB")} pcs</span></span>
                  <span className="order-fold-end">
                    <strong>{totals.byCurrency.map(item => `${item.currency} ${fmt(item.total)}`).join(" + ") || "—"}</strong>
                    <span className={`badge ${status.badge}`}>{status.label}</span>
                  </span>
                </summary>
                <div className="table-wrap order-table"><table>
                  <thead><tr><th>Code</th><th>Product</th><th>Quantity</th><th>Price</th><th>Total</th></tr></thead>
                  <tbody>{items.map(item => (
                    <tr key={item.id}>
                      <td className="code-cell">{item.sku ?? "—"}</td><td>{item.product_name}</td>
                      <td>{Number(item.quantity).toLocaleString("en-GB")}</td>
                      <td>{item.unit_price === null ? "—" : `${item.currency} ${fmt(Number(item.unit_price))}`}</td>
                      <td className="num">{item.unit_price === null ? "—" : `${item.currency} ${fmt(Number(item.quantity) * Number(item.unit_price))}`}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
                {order.note && <p className="small" style={{ marginBottom: 0 }}><strong>Your note:</strong> {order.note}</p>}
              </details>
            );
          })}
        </div>
      )}
    </CompanySession>
  );
}
