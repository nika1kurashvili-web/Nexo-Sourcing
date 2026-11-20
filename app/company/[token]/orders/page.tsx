import { INVALID_COMPANY_LINK, readCompanyOrders } from "@/lib/company-portal";
import { lineTotals, paymentSummary } from "@/lib/company-orders";
import { balanceTone } from "@/lib/orders";
import { CompanyPayments } from "@/components/CompanyPayments";
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
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tbilisi" });
  return (
    <CompanySession token={token}>
      <CompanyNav token={token} active="orders" companyName={data.companyName} />
      {data.orders.length === 0 ? <div className="card empty">You have not sent any orders yet.</div> : (
        <div className="stack">
          {data.orders.map(order => {
            const items: any[] = order.sourcing_company_order_items ?? [];
            const totals = lineTotals(items.map(item => ({ quantity: Number(item.quantity), unit_price: item.unit_price === null ? null : Number(item.unit_price), currency: item.currency })));
            const status = STATUS[order.status] ?? STATUS.new;
            const payments: any[] = [...(order.sourcing_company_payments ?? [])].sort((a, b) => String(a.paid_on).localeCompare(String(b.paid_on)) || String(a.created_at).localeCompare(String(b.created_at)));
            const summary = paymentSummary(items.map(item => ({ quantity: Number(item.quantity), unit_price: item.unit_price === null ? null : Number(item.unit_price), currency: item.currency })), payments);
            return (
              <details className="card order-fold" key={order.id}>
                <summary className="order-fold-head">
                  <span className="order-fold-title"><strong>{order.order_no}</strong>
                    <span className="muted small">{new Date(order.created_at).toLocaleDateString("en-GB", { timeZone: "Asia/Tbilisi" })} · {items.length} product{items.length === 1 ? "" : "s"} · {totals.totalQuantity.toLocaleString("en-GB")} pcs</span></span>
                  <span className="order-fold-end">
                    <strong>{totals.byCurrency.map(item => `${item.currency} ${fmt(item.total)}`).join(" + ") || "—"}</strong>
                    <span className={`badge ${status.badge}`}>{status.label}</span>
                    {summary.map(row => {
                      const tone = balanceTone(row);
                      return <span key={row.currency} className={`balance-pill ${tone}`}>{tone === "paid" ? `✓ ${row.currency} paid` : tone === "over" ? `▲ ${row.currency} ${fmt(Math.abs(row.balance))} over` : `${row.currency} ${fmt(row.balance)} to pay`}</span>;
                    })}
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
                {order.note && <p className="small"><strong>Your note:</strong> {order.note}</p>}
                {summary.length > 0 && (
                  <div className="table-wrap"><table>
                    <thead><tr><th>Currency</th><th>Order total</th><th>Paid (confirmed)</th><th>Waiting for Nexo</th><th>Balance</th></tr></thead>
                    <tbody>{summary.map(row => (
                      <tr key={row.currency}><td>{row.currency}</td><td className="num">{fmt(row.total)}</td><td className="num">{fmt(row.paid)}</td>
                        <td className="num">{row.pending ? fmt(row.pending) : "—"}</td><td className="num"><strong>{fmt(row.balance)}</strong></td></tr>
                    ))}</tbody>
                  </table></div>
                )}
                <CompanyPayments token={token} orderId={order.id} payments={payments} cancelled={order.status === "cancelled"} today={today}
                  currencies={Array.from(new Set(items.map(item => item.currency as string)))} />
              </details>
            );
          })}
        </div>
      )}
    </CompanySession>
  );
}
