"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importOrderAction, type OrderImportResult } from "@/app/order-import-actions";

const CURRENCIES = ["USD", "CNY", "EUR", "GEL"];

// Pick supplier + currency, upload barcode/quantity Excel, check it, then create the order.
export function OrderExcelUpload({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [supplierId, setSupplierId] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OrderImportResult | null>(null);

  async function send(dry: boolean) {
    const file = input.current?.files?.[0];
    const problem = (error: string): OrderImportResult => ({ ok: false, dryRun: true, lines: 0, priced: 0, unpriced: 0, errors: [], warnings: [], error });
    if (!supplierId) { setResult(problem("Select a supplier.")); return; }
    if (!file) { setResult(problem("Choose an Excel (.xlsx) file.")); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file); form.set("supplier_id", supplierId); form.set("currency", currency); form.set("dry", dry ? "1" : "0");
      const outcome = await importOrderAction(form);
      setResult(outcome);
      if (!dry && outcome.ok && outcome.orderId) router.push(`/orders/${outcome.orderId}`);
    } catch {
      setResult(problem("The file could not be sent. Check your connection and try again."));
    } finally { setBusy(false); }
  }

  const reset = () => setResult(null);
  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <p className="small muted" style={{ margin: 0 }}>
        Excel with two columns: <strong>Barcode</strong> (the product Code/SKU) and <strong>Quantity</strong>. The order is created with each product's catalog price
        (only when the product's currency equals the order currency). <a href="/orders/template">Download template</a>
      </p>
      <div className="form-grid two">
        <label>Supplier *
          <select value={supplierId} onChange={event => { setSupplierId(event.target.value); reset(); }} disabled={busy}>
            <option value="">Select supplier</option>
            {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
        </label>
        <label>Currency
          <select value={currency} onChange={event => { setCurrency(event.target.value); reset(); }} disabled={busy}>
            {CURRENCIES.map(code => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
      </div>
      <label>Excel file (.xlsx)
        <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={reset} />
      </label>
      <div className="product-actions">
        <button className="btn secondary" type="button" onClick={() => send(true)} disabled={busy}>{busy ? "Please wait..." : "1. Check file"}</button>
        <button className="btn" type="button" onClick={() => send(false)} disabled={busy || !result?.ok || !result.dryRun}>2. Create order</button>
      </div>
      {result && (
        <div className={result.ok ? "small" : "notice"} role="status">
          {result.error && <div>{result.error}</div>}
          {result.ok && result.dryRun && <div><strong>File is valid:</strong> {result.lines} product(s), {result.priced} with a price. Press "2. Create order".</div>}
          {result.ok && !result.dryRun && <div><strong>Order created.</strong> Opening it...</div>}
          {result.errors.length > 0 && <><div><strong>No order was created. Fix these rows and check again:</strong></div>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{result.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></>}
          {result.warnings.map((warning, index) => <div key={index} className="muted">{warning}</div>)}
        </div>
      )}
    </div>
  );
}
