"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importProductsAction, type ImportResult } from "@/app/product-import-actions";

// Download the product sheet, edit it in Excel, and upload it back (check first, then import).
export function ProductExcel({ suppliers, defaultSupplierId = "" }: { suppliers: { id: string; name: string }[]; defaultSupplierId?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [supplierId, setSupplierId] = useState(defaultSupplierId);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);

  async function send(dry: boolean) {
    const file = input.current?.files?.[0];
    if (!supplierId) { setChecked({ ok: false, dryRun: true, created: 0, updated: 0, errors: [], warnings: [], error: "Select a supplier." }); return; }
    if (!file) { setChecked({ ok: false, dryRun: true, created: 0, updated: 0, errors: [], warnings: [], error: "Choose an Excel (.xlsx) file." }); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file); form.set("supplier_id", supplierId); form.set("dry", dry ? "1" : "0");
      const result = await importProductsAction(form);
      if (dry) { setChecked(result); setDone(null); }
      else { setDone(result); setChecked(null); if (result.ok && input.current) input.current.value = ""; router.refresh(); }
    } catch {
      setChecked({ ok: false, dryRun: dry, created: 0, updated: 0, errors: [], warnings: [], error: "The file could not be sent. Check your connection and try again." });
    } finally { setBusy(false); }
  }

  const exportHref = supplierId ? `/products/export?supplier=${supplierId}` : "/products/export";
  return (
    <div className="stack">
      <div className="product-actions">
        <a className="btn secondary" href={exportHref}>Download products (Excel){supplierId ? "" : " - all suppliers"}</a>
        <a className="btn secondary" href="/products/export?template=1">Download empty template</a>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        One supplier per file. A row whose <strong>Code (SKU)</strong> already exists updates that product; a new or empty code creates a product. Photos are not part of the Excel file: upload them separately below, named after the code.
      </p>
      <div className="form-grid two">
        <label>Supplier *
          <select value={supplierId} onChange={event => { setSupplierId(event.target.value); setChecked(null); setDone(null); }} disabled={busy}>
            <option value="">Select supplier</option>
            {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
        </label>
        <label>Excel file (.xlsx)<input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy}
          onChange={() => { setChecked(null); setDone(null); }} /></label>
      </div>
      <div className="product-actions">
        <button className="btn secondary" type="button" onClick={() => send(true)} disabled={busy}>{busy ? "Please wait..." : "1. Check file"}</button>
        <button className="btn" type="button" onClick={() => send(false)} disabled={busy || !checked?.ok}>2. Import</button>
      </div>
      {checked && (
        <div className={checked.ok ? "small" : "notice"} role="status">
          {checked.error && <div>{checked.error}</div>}
          {checked.ok && <div><strong>File is valid:</strong> {checked.created} new product(s), {checked.updated} to update. Press "2. Import" to apply.</div>}
          {checked.errors.length > 0 && <><div><strong>Nothing was imported. Fix these rows and check again:</strong></div>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{checked.errors.map((error, index) => <li key={index}>{error}</li>)}</ul></>}
          {checked.warnings.map((warning, index) => <div key={index} className="muted">{warning}</div>)}
        </div>
      )}
      {done && (
        <div className={done.ok ? "small" : "notice"} role="status">
          {done.ok ? <strong>Imported: {done.created} created, {done.updated} updated.</strong> : <strong>The import did not finish.</strong>}
          {done.error && <div>{done.error}</div>}
          {done.errors.map((error, index) => <div key={index}>{error}</div>)}
        </div>
      )}
    </div>
  );
}
