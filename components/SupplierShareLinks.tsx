import { requireSourcingAccess } from "@/lib/auth";
import { SupplierShareLinkControls } from "@/components/SupplierShareLinkControls";

export async function SupplierShareLinks({ requestId, suppliers }: {
  requestId: string;
  suppliers: { id: string; name: string; count: number }[];
}) {
  const { supabase } = await requireSourcingAccess();
  const { data, error } = await supabase.from("sourcing_supplier_share_links")
    .select("id,supplier_id,active,expires_at").eq("request_id", requestId).eq("active", true);
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
          requestId={requestId} supplier={supplier} link={data?.find(link => link.supplier_id === supplier.id) ?? null} />)}</div>}
    </section>
  );
}
