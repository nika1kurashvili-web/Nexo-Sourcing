"use client";

import { useMemo, useState } from "react";

type Row = { id: string; sku: string; name: string; price: number | null; currency: string };

// Searchable list of the supplier's approved products with a tick box and a quantity each.
// Plain text only (no photos) so even a 300-product catalog stays light.
export function OrderProductPicker({ products, inOrder, orderId, orderCurrency, action }: {
  products: Row[]; inOrder: string[]; orderId: string; orderCurrency: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const taken = useMemo(() => new Set(inOrder), [inOrder]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter(product => !taken.has(product.id)
      && (!needle || product.name.toLowerCase().includes(needle) || product.sku.toLowerCase().includes(needle)));
  }, [products, taken, query]);

  return (
    <form action={action} className="stack">
      <input type="hidden" name="order_id" value={orderId} />
      <label>Search products<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or code" /></label>
      {shown.length === 0 ? <div className="muted">No more products to add.</div> : (
        <div className="table-wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
          <table>
            <thead><tr><th></th><th>Code</th><th>Product</th><th>Catalog price</th><th>Quantity</th></tr></thead>
            <tbody>
              {shown.slice(0, 200).map(product => (
                <tr key={product.id}>
                  <td><input type="checkbox" name="product" value={product.id} aria-label={`Add ${product.name}`} /></td>
                  <td>{product.sku}</td>
                  <td>{product.name}</td>
                  <td>{product.price === null ? "—" : `${product.currency} ${product.price}`}
                    {product.price !== null && product.currency !== orderCurrency && <div className="small muted">other currency, not used</div>}</td>
                  <td><input type="number" name={`qty_${product.id}`} min="0.01" step="any" defaultValue="1" style={{ width: 90 }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > 200 && <div className="small muted">Showing the first 200 matches. Use the search to narrow down.</div>}
      <div><button className="btn" type="submit">Add ticked products</button></div>
    </form>
  );
}
