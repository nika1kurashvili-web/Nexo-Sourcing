"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LineSearch } from "@/components/LineSearch";

type Item = { id: string; sku: string | null; name: string; quantity: number; price: number | null; proposed: number | null; proposedQty: number | null; prepared: boolean; photoId: string | null };
type Order = { id: string; order_no: string; currency: string; status: "sent" | "confirmed"; items: Item[] };

const fmt = (value: number) => value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

function Line({ token, order, item }: { token: string; order: Order; item: Item }) {
  const router = useRouter();
  const open = order.status === "sent";
  const [value, setValue] = useState(item.proposed !== null ? String(item.proposed) : item.price !== null ? String(item.price) : "");
  const [qty, setQty] = useState(item.proposedQty !== null ? String(item.proposedQty) : String(item.quantity));
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

  async function send(operation: "set_price" | "set_quantity", field: "price" | "quantity", value: string | null) {
    const response = await fetch(`/api/supplier-catalog/${token}/orders`, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", referrerPolicy: "no-referrer",
      body: JSON.stringify({ operation, itemId: item.id, [field]: value })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Unable to save.");
  }

  const priceChanged = value.trim() !== "" && Number(value) !== (item.proposed ?? item.price);
  const qtyChanged = qty.trim() !== "" && Number(qty) !== (item.proposedQty ?? item.quantity);

  // Sends only what changed. Nothing applies until Nexo approves it.
  async function submit() {
    setBusy(true); setMessage(""); setFailed(false);
    try {
      if (priceChanged) await send("set_price", "price", value);
      if (qtyChanged) await send("set_quantity", "quantity", qty);
      setMessage("Sent to Nexo for approval.");
      router.refresh();
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : "Unable to save.");
    } finally { setBusy(false); }
  }

  async function withdraw() {
    setBusy(true); setMessage(""); setFailed(false);
    try {
      if (item.proposed !== null) await send("set_price", "price", null);
      if (item.proposedQty !== null) await send("set_quantity", "quantity", null);
      setValue(item.price === null ? "" : String(item.price)); setQty(String(item.quantity));
      setMessage("Suggestion removed.");
      router.refresh();
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : "Unable to save.");
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
      <td className="num">{open
        ? <input type="number" min="0.01" step="any" value={qty} onChange={event => setQty(event.target.value)} style={{ width: 84 }} disabled={busy} aria-label={`Quantity for ${item.name}`} />
        : item.quantity.toLocaleString("en-GB")}
        {item.proposedQty !== null && <div className="small muted">now {item.quantity.toLocaleString("en-GB")}</div>}</td>
      <td className="num">{item.price === null ? <span className="muted">not set</span> : `${order.currency} ${fmt(item.price)}`}</td>
      <td className="num"><strong>{item.price === null ? <span className="muted">—</span> : `${order.currency} ${fmt(Math.round(item.quantity * item.price * 100) / 100)}`}</strong></td>
      <td>
        {open ? (
          <div className="stack" style={{ gap: 6 }}>
            <div className="product-actions">
              <input type="number" min="0" step="any" value={value} onChange={event => setValue(event.target.value)}
                placeholder={`New price (${order.currency})`} style={{ width: 110 }} disabled={busy} aria-label={`Suggested price for ${item.name}`} />
              <button className="btn sm" type="button" disabled={busy || (!priceChanged && !qtyChanged)} onClick={() => void submit()}>Send correction</button>
              {(item.proposed !== null || item.proposedQty !== null) && <button className="btn secondary sm" type="button" disabled={busy} onClick={() => void withdraw()}>Withdraw</button>}
            </div>
            {(item.proposed !== null || item.proposedQty !== null) && <span className="badge warning">Waiting for Nexo:{item.proposedQty !== null ? ` qty ${item.proposedQty.toLocaleString("en-GB")}` : ""}{item.proposed !== null ? ` price ${order.currency} ${fmt(item.proposed)}` : ""}</span>}
            {message && <span role={failed ? "alert" : "status"} className={failed ? "notice" : "small"}>{message}</span>}
          </div>
        ) : <span className="muted small">Order confirmed: prices and quantities are locked. Ask Nexo to reopen it to change them.</span>}
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
        const prepared = order.items.filter(item => item.prepared).length;
        const waiting = order.items.filter(item => item.proposed !== null).length;
        const unpriced = order.items.filter(item => item.price === null).length;
        return (
          <details className="card order-fold" key={order.id}>
            <summary className="order-fold-head">
              <span className="order-fold-title"><strong>{order.order_no}</strong><span className="muted small">{order.currency} · {order.items.length} product{order.items.length === 1 ? "" : "s"} · Prepared {prepared}/{order.items.length}</span></span>
              <span className="order-fold-end">
                <strong>{order.currency} {fmt(Math.round(total * 100) / 100)}</strong>
                {waiting > 0 && <span className="badge warning">{waiting} waiting</span>}
                <span className={`badge ${order.status === "confirmed" ? "success" : "warning"}`}>{order.status === "confirmed" ? "Confirmed" : "Open for price suggestions"}</span>
                <span className="order-fold-chevron" aria-hidden="true">▾</span>
              </span>
            </summary>
            <div style={{ marginTop: 14 }}>
            <div className="grid-4" style={{ marginBottom: 14 }}>
              <div className="stat"><div className="muted small">Total (approved prices)</div><div className="stat-value" style={{ fontSize: 20 }}>{order.currency} {fmt(Math.round(total * 100) / 100)}</div>
                {unpriced > 0 && <div className="small muted">{unpriced} without an approved price</div>}</div>
              <div className="stat"><div className="muted small">Prepared</div><div className="stat-value" style={{ fontSize: 20 }}>{prepared} / {order.items.length}</div>
                <div className="small muted">tick each packed product</div></div>
              <div className="stat"><div className="muted small">Waiting for Nexo</div><div className="stat-value" style={{ fontSize: 20 }}>{waiting}</div>
                <div className="small muted">price suggestion{waiting === 1 ? "" : "s"}</div></div>
              <div className="stat"><div className="muted small">Products</div><div className="stat-value" style={{ fontSize: 20 }}>{order.items.length}</div></div>
            </div>
            <LineSearch><div className="table-wrap order-table"><table>
              <thead><tr><th>Prepared</th><th>Photo</th><th>Code</th><th>Product</th><th>Quantity (edit)</th><th>Approved price</th><th>Line total</th><th>Your correction</th></tr></thead>
              <tbody>{order.items.map(item => <Line key={item.id} token={token} order={order} item={item} />)}</tbody>
            </table></div></LineSearch>
            <p className="small muted" style={{ marginBottom: 0 }}>Tick "Prepared" when a product is packed and ready, so Nexo can see it. You can correct the quantity and/or the price while the order is open: change the numbers and press "Send correction"; it applies once Nexo approves it; prepared marks work until the order is finished.</p>
            </div>
          </details>
        );
      })}
    </div>
  );
}
