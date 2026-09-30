"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupplierLink, revokeSupplierLink } from "@/app/share-link-actions";

export function SupplierShareLinkControls({ requestId, supplier, link }: {
  requestId: string; supplier: { id: string; name: string; count: number };
  link: { id: string; expires_at: string | null } | null;
}) {
  const router = useRouter();
  const [created, setCreated] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [days, setDays] = useState(30);
  const currentId = link?.id ?? created?.id;
  const expiresAt = link?.expires_at ?? created?.expiresAt;
  const expired = !!expiresAt && Date.parse(expiresAt) <= Date.now();
  const url = created?.id === currentId ? created?.url : null;

  async function run(revoke: boolean) {
    if (revoke && !confirm("Are you sure you want to revoke this supplier link? The current URL will stop working immediately.")) return;
    setBusy(true); setMessage("");
    try {
      if (revoke && currentId) {
        const result = await revokeSupplierLink(requestId, supplier.id, currentId);
        if (result.error) setMessage(result.error);
        else { setCreated(null); setMessage("Link revoked."); router.refresh(); }
      } else {
        const result = await createSupplierLink(requestId, supplier.id, days);
        if (result.error) setMessage(result.error);
        else if (result.id && result.url && result.expiresAt) {
          setCreated({ id: result.id, url: result.url, expiresAt: result.expiresAt });
          setMessage("Link created. Copy it now; the full link is shown only in this session.");
          router.refresh();
        }
      }
    } catch { setMessage("Unable to manage this link. Please try again."); }
    finally { setBusy(false); }
  }

  return <div className="share-row">
    <div><strong>{supplier.name}</strong><div className="small muted">{supplier.count} items assigned</div></div>
    <div className="upload-controls">
      {(!currentId || expired) && supplier.count > 0 && <>
        <label>Link expires in<select disabled={busy} value={days} onChange={e => setDays(Number(e.target.value))}>
          {[7,30,90].map(value => <option key={value} value={value}>{value} days</option>)}
        </select></label>
        <button className="btn" disabled={busy} onClick={() => void run(false)}>Create Share Link</button>
      </>}
      {url && !expired && <>
        <button className="btn secondary" disabled={busy} onClick={async () => {
          try { await navigator.clipboard.writeText(url); setMessage("Link copied."); }
          catch { setMessage("Copy the link from the field below."); }
        }}>Copy Link</button>
        <a className="btn secondary" href={url} target="_blank" rel="noopener noreferrer">Open</a>
      </>}
      {currentId && <button className="btn danger" disabled={busy} onClick={() => void run(true)}>Revoke</button>}
    </div>
    {url && !expired && <input aria-label="Supplier share link" value={url} readOnly onFocus={e => e.target.select()} />}
    {currentId && !url && !expired && <p className="small muted">An active link exists. For security, its full URL cannot be retrieved. Use your saved copy, or revoke it and create a new link.</p>}
    {expiresAt && <div className="small muted">{expired ? "Expired" : "Expires"}: {new Date(expiresAt).toLocaleString("en-GB")}</div>}
    {message && <div role="status" className="small">{message}</div>}
  </div>;
}
