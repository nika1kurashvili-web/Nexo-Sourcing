"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCatalogLinkAction, revokeCatalogLinkAction } from "@/app/product-actions";

// One permanent catalog link per supplier. The link stays visible here, so it can be
// copied again at any time without revoking and recreating it.
export function CatalogLinkControls({ supplier, link }: {
  supplier: { id: string; name: string };
  link: { id: string; url: string | null } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
  const current = link ? { id: link.id, url: link.url ?? (created?.id === link.id ? created.url : null) } : created;

  async function create() {
    setBusy(true); setMessage("");
    const result: any = await createCatalogLinkAction(supplier.id);
    if (result.error) setMessage(result.error);
    else { setCreated({ id: result.id, url: result.url }); setMessage("Link created."); router.refresh(); }
    setBusy(false);
  }
  async function revoke() {
    if (!current || !confirm("Revoke this catalog link? The supplier will immediately lose access to it.")) return;
    setBusy(true); setMessage("");
    const result: any = await revokeCatalogLinkAction(supplier.id, current.id);
    if (result.error) setMessage(result.error);
    else { setCreated(null); setMessage("Link revoked."); router.refresh(); }
    setBusy(false);
  }

  return (
    <div className="share-row">
      <strong>{supplier.name}</strong>
      <div className="upload-controls">
        {!current && <button className="btn" disabled={busy} onClick={() => void create()}>Create Catalog Link</button>}
        {current?.url && <>
          <button className="btn secondary" disabled={busy} onClick={async () => {
            try { await navigator.clipboard.writeText(current.url as string); setMessage("Link copied."); }
            catch { setMessage("Copy the link from the field below."); }
          }}>Copy Link</button>
          <a className="btn secondary" href={current.url} target="_blank" rel="noopener noreferrer">Open Link</a>
        </>}
        {current && <button className="btn danger" disabled={busy} onClick={() => void revoke()}>Revoke Link</button>}
      </div>
      {current?.url && <input aria-label="Supplier catalog link" value={current.url} readOnly onFocus={event => event.target.select()} />}
      {current && !current.url && <p className="small muted">This link exists, but its URL cannot be shown. Revoke it and create a new one.</p>}
      {message && <div role="status" className="small">{message}</div>}
    </div>
  );
}
