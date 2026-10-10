"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LineSearch } from "@/components/LineSearch";

type Item = { id: string; sku: string | null; name: string; quantity: number; price: number | null; proposed: number | null; prepared: boolean; photoId: string | null };
type Order = { id: string; order_no: string; currency: string; status: "sent" | "confirmed"; items: Item[] };

const fmt = (value: number) => value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function Line({ token, order, item }: { token: string; order: Order; item: Item }) {
  const router = useRouter();
  const open = order.status === "sent";
  const [value, setValue] = useState(item.proposed === null ? "" : String(item.proposed));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(item.prepared);

  async function toggleReady(next: boolean) {
    setBusy(true); setMessage(""); setFailed(false);
    const before = ready;
    setReady(next);
    try {
      const response = await fetch(`/api/supplier-catalog/${token}/orders`, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", referrerPolicy: "no-referrer",
        body: JSON.stringify({ operation: "set_ready", itemId: item.id, ready: next })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to save.");
      router.refresh();
    } catch (error) {
      setReady(before);
      setFailed(true); setMessage(error instanceof Error ? error.message : "Unable to save.");
    } finally { setBusy(false); }
  }

  async function save(price: string | null) {
    setBusy(true); setMessage(""); setFailed(false);
    try {
      const response = await fetch(`/api/supplier-catalog/${token}/orders`, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", referrerPolicy: "no-referrer",
        body: JSON.stringify({ operation: "set_price", itemId: item.id, price })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to save the price.");
      setMessage(price === null ? "Suggestion removed." : "Sent to Nexo for approval.");
      router.refresh();
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : "Unable to save the price.");
    } finally { setBusy(false); }
  }

  return (
    <tr>
      <td style={{ textAlign: "center" }}>
        <input type="checkbox" checked={ready} disabled={busy} onChange={event => void toggleReady(event.target.checked)}
          aria-label={`${item.name} is prepared`} style={{ width: 22, height: 22 }} />
      </td>
      <td className="thumb-cell">{item.photoId
        ? <a href={`/api/supplier-catalog/${token}/images/${item.photoId}`} target="_blank" rel="noopener noreferrer"><img className="order-thumb" src={`/api/supplier-catalog/${token}/images/${item.photoId}`} referrerPolicy="no-referrer" alt={item.name} loading="lazy" /></a>
        : <div className="order-thumb empty">—</div>}</td>
      <td className="code-cell">{item.sku ?? "—"}</td>
      <td>{item.name}</td>
      <td>{item.quantity.toLocaleString("en-GB")}</td>
      <td>{item.price === null ? <span className="muted">not set</span> : `${order.currency} ${fmt(item.price)}`}</td>
      <td>
        {open ? (
          <div className="stack" style={{ gap: 6 }}>
            <div className="product-actions">
              <input type="number" min="0" step="any" value={value} onChange={event => setValue(event.target.value)}
                placeholder={`Price (${order.currency})`} style={{ width: 110 }} disabled={busy} aria-label={`Suggested price for ${item.name}`} />
              <button className="btn sm" type="button" disabled={busy || value.trim() === ""} onClick={() => save(value)}>Suggest</button>
              {item.proposed !== null && <button className="btn secondary sm" type="button" disabled={busy} onClick={() => { setValue(""); void save(null); }}>Withdraw</button>}
            </div>
            {item.proposed !== null && <span className="badge warning">Waiting for Nexo: {order.currency} {fmt(item.proposed)}</span>}
            {message && <span role={failed ? "alert" : "status"} className={failed ? "notice" : "small"}>{message}</span>}
          </div>
        ) : <span className="muted">—</span>}
      </td>
    </tr>
  );
}

export function SupplierOrders({ token, supplierName, orders }: { token: string; supplierName: string; orders: Order[] }) {
  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>Orders for {supplierName}</h2>
      {orders.length === 0 && <div className="card empty">No orders yet.</div>}
      {orders.map(order => {
        const total = order.items.reduce((sum, item) => sum + (item.price === null ? 0 : Math.round(item.quantity * item.price * 100) / 100), 0);
        return (
          <div className="card" key={order.id}>
            <div className="page-head" style={{ marginBottom: 8 }}>
              <div><h2 style={{ margin: 0 }}>{order.order_no}</h2><div className="muted small">{order.currency}</div></div>
              <span className={`badge ${order.status === "confirmed" ? "success" : "warning"}`}>{order.status === "confirmed" ? "Confirmed" : "Open for price suggestions"}</span>
            </div>
            <LineSearch><div className="table-wrap order-table"><table>
              <thead><tr><th>Prepared</th><th>Photo</th><th>Code</th><th>Product</th><th>Quantity</th><th>Approved price</th><th>Your suggestion</th></tr></thead>
              <tbody>{order.items.map(item => <Line key={item.id} token={token} order={order} item={item} />)}</tbody>
            </table></div></LineSearch>
            <p className="small muted">Tick "Prepared" when a product is packed and ready, so Nexo can see it. Price suggestions can be sent while the order is open; prepared marks work until the order is finished.</p>
            <p style={{ marginBottom: 0 }}><strong>Total (approved prices): {order.currency} {fmt(Math.round(total * 100) / 100)}</strong></p>
          </div>
        );
      })}
    </div>
  );
}
