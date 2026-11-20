"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { lineTotals, parseQuantityText } from "@/lib/company-orders";
import type { CatalogProduct } from "@/lib/company-portal";

const fmt = (value: number) => value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CompanyCatalog({ token, products }: { token: string; products: CatalogProduct[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? products.filter(product => product.name.toLowerCase().includes(needle) || (product.sku ?? "").toLowerCase().includes(needle)) : products;
  }, [products, search]);

  const chosen = products.flatMap(product => {
    const quantity = parseQuantityText(qty[product.id]);
    return quantity ? [{ product, quantity }] : [];
  });
  const totals = lineTotals(chosen.map(({ product, quantity }) => ({ quantity, unit_price: product.price, currency: product.currency })));
  const invalid = products.some(product => (qty[product.id] ?? "").trim() !== "" && parseQuantityText(qty[product.id]) === null);

  async function send() {
    if (!chosen.length || invalid || busy) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/company/${token}/orders`, {
        method: "POST", headers: { "Content-Type": "application/json" }, referrerPolicy: "no-referrer",
        body: JSON.stringify({ items: chosen.map(({ product, quantity }) => ({ productId: product.id, quantity })), note })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) setMessage({ text: result.error ?? "Unable to send the order.", ok: false });
      else { setQty({}); setNote(""); setMessage({ text: `Order ${result.orderNo} was sent to Nexo.`, ok: true }); router.refresh(); }
    } catch {
      setMessage({ text: "Unable to send the order. Check your connection and try again.", ok: false });
    }
    setBusy(false);
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <label>Search by name or code
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or code" />
        </label>
        <div className="small muted" style={{ marginTop: 8 }}>{products.length} product{products.length === 1 ? "" : "s"}. Enter a quantity under each product you want, then send the order below.</div>
      </div>

      {message && <div className={message.ok ? "notice success" : "notice"} role="status" style={{ marginBottom: 14 }}>
        {message.text} {message.ok && <Link href={`/company/${token}/orders`}>View my orders</Link>}
      </div>}

      {products.length === 0 ? <div className="card empty">No products are available for you yet.</div>
        : shown.length === 0 ? <div className="card empty">Nothing found.</div> : (
        <div className="product-grid">
          {shown.map(product => (
            <div className="product-card" key={product.id}>
              {product.hasPhoto
                ? <img className="company-photo" src={`/api/company/${token}/images/${product.id}`} alt={product.name} loading="lazy" referrerPolicy="no-referrer" />
                : <div className="company-photo empty">No photo</div>}
              {product.sku && <div className="small muted">{product.sku}</div>}
              <div className="product-title">{product.name}</div>
              <div><strong>{product.price === null ? "Price on request" : `${product.currency} ${fmt(product.price)}`}</strong>{product.qtyInBox ? <span className="small muted"> · {product.qtyInBox} per box</span> : null}</div>
              {product.description && <p className="product-text">{product.description}</p>}
              {product.specifications && <p className="product-text muted">{product.specifications}</p>}
              <label className="small">Quantity
                <input inputMode="decimal" value={qty[product.id] ?? ""} placeholder="0" aria-invalid={(qty[product.id] ?? "").trim() !== "" && parseQuantityText(qty[product.id]) === null}
                  onChange={event => setQty(current => ({ ...current, [product.id]: event.target.value }))} />
              </label>
            </div>
          ))}
        </div>
      )}

      {chosen.length > 0 && (
        <div className="card company-bar">
          <div>
            <strong>{chosen.length} product{chosen.length === 1 ? "" : "s"} · {totals.totalQuantity.toLocaleString("en-GB")} pcs</strong>
            <div className="small muted">
              {totals.byCurrency.map(item => `${item.currency} ${fmt(item.total)}`).join(" + ") || "No prices"}
              {totals.unpriced > 0 ? ` · ${totals.unpriced} without price` : ""}
            </div>
          </div>
          <label className="small" style={{ flex: 1, minWidth: 180 }}>Note (optional)
            <input value={note} maxLength={1000} onChange={event => setNote(event.target.value)} placeholder="Anything Nexo should know" />
          </label>
          <button className="btn" type="button" disabled={busy || invalid} onClick={() => void send()}>{busy ? "Sending…" : "Send order"}</button>
          {invalid && <div className="small" style={{ color: "#b42318" }}>Fix the quantities marked in red.</div>}
        </div>
      )}
    </>
  );
}
