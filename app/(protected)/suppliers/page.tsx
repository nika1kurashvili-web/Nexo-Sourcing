import { createSupplierAction } from "@/app/actions";
import { requireSourcingAccess } from "@/lib/auth";
import { SupplierEditForm } from "@/components/SupplierEditForm";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const { supabase } = await requireSourcingAccess();
  const { data } = await supabase.from("sourcing_suppliers").select("*").order("name");
  const suppliers = data ?? [];

  return (
    <>
      <div className="page-head"><div><h1>Suppliers</h1><div className="muted">Sourcing agents and suppliers</div></div></div>
      {params.error && <div className="notice">Unable to add supplier.</div>}
      <div className="two-col">
        <div className="card">
          <h2>New Supplier</h2><hr />
          <form action={createSupplierAction} className="form-grid">
            <label>Name / Company *<input name="name" required /></label>
            <label>Contact Person<input name="contact_name" /></label>
            <label>WeChat<input name="wechat" /></label>
            <label>Phone<input name="phone" /></label>
            <label>Email<input name="email" type="email" /></label>
            <label>Notes<textarea name="notes" /></label>
            <button className="btn" type="submit">Add</button>
          </form>
        </div>
        <div className="card">
          <h2>Suppliers ({suppliers.length})</h2><hr />
          {suppliers.length === 0 ? <div className="empty">No suppliers yet.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Contact</th><th>WeChat</th><th>Phone</th><th>Actions</th></tr></thead>
              <tbody>{suppliers.map((s:any) => <tr key={s.id}>
                <td><strong>{s.name}</strong></td><td>{s.contact_name ?? "—"}</td><td>{s.wechat ?? "—"}</td><td>{s.phone ?? "—"}</td>
                <td><SupplierEditForm supplier={{ id: s.id, name: s.name, contact_name: s.contact_name, phone: s.phone, email: s.email, wechat: s.wechat, notes: s.notes }} /></td>
              </tr>)}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </>
  );
}
