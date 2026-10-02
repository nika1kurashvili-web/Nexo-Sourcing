import { requireSourcingAccess } from "@/lib/auth";
import { SupplierShareLinkControls } from "@/components/SupplierShareLinkControls";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptShareToken, supplierLinkUrl } from "@/lib/share-link-crypto";

export async function SupplierShareLinks({ requestId, suppliers }: {
  requestId: string;
  suppliers: { id: string; name: string; count: number }[];
}) {
  const { supabase } = await requireSourcingAccess();
  const { data, error } = await supabase.from("sourcing_supplier_share_links")
    .select("id,supplier_id,active,expires_at").eq("request_id", requestId).eq("active", true);
  // Saved links: the encrypted token is readable only by the server, after the
  // staff access check above. Older links (or a missing migration) simply show no URL.
  const urls = new Map<string, string>();
  if (data?.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { data: saved } = await createAdminClient().from("sourcing_supplier_share_links")
        .select("id,token_encrypted").eq("request_id", requestId).eq("active", true);
      for (const row of saved ?? []) {
        const token = decryptShareToken(row.token_encrypted as string | null);
        if (token) urls.set(row.id as string, supplierLinkUrl(token));
      }
    } catch { /* keep the page working without saved URLs */ }
  }
  // Keep links revocable even after the supplier has zero assigned items.
  const assignedIds = new Set(suppliers.map(supplier => supplier.id));
  const unassignedIds = (data ?? []).map(link => link.supplier_id as string).filter(id => !assignedIds.has(id));
  const extra = unassignedIds.length ? await supabase.from("sourcing_suppliers").select("id,name").in("id", unassignedIds) : { data: [] };
  const rows = [...suppliers, ...(extra.data ?? []).map(supplier => ({ ...supplier, count: 0 }))];
  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <h2>Supplier Share Links</h2>
      <p className="small muted">Each link allows access only to the items currently assigned to that supplier in this request. Anyone with the link can respond.</p>
      {error ? <p className="notice">Supplier sharing is not configured. Apply the supplier portal migration to enable it.</p> :
        rows.length === 0 ? <p className="muted">Assign a supplier to an item to create a share link.</p> :
        <div className="stack">{rows.map(supplier => <SupplierShareLinkControls key={supplier.id}
          requestId={requestId} supplier={supplier} link={(() => { const found = data?.find(link => link.supplier_id === supplier.id); return found ? { ...found, url: urls.get(found.id as string) ?? null } : null; })()} />)}</div>}
    </section>
  );
}
