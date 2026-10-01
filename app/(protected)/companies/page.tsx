import { createCompanyAction } from "@/app/actions";
import { requireSourcingAccess } from "@/lib/auth";
import { CompanyEditForm } from "@/components/CompanyEditForm";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const { supabase } = await requireSourcingAccess();
  const { data } = await supabase.from("sourcing_companies").select("*").order("name");
  const companies = data ?? [];

  return (
    <>
      <div className="page-head"><div><h1>Companies</h1><div className="muted">Client companies</div></div></div>
      {params.error && <div className="notice">Unable to add company.</div>}
      <div className="two-col">
        <div className="card">
          <h2>New Company</h2><hr />
          <form action={createCompanyAction} className="form-grid">
            <label>Company Name *<input name="name" required /></label>
            <label>Contact Person<input name="contact_name" /></label>
            <label>Phone<input name="phone" /></label>
            <label>Email<input name="email" type="email" /></label>
            <label>Notes<textarea name="notes" /></label>
            <button className="btn" type="submit">Add</button>
          </form>
        </div>
        <div className="card">
          <h2>Companies ({companies.length})</h2><hr />
          {companies.length === 0 ? <div className="empty">No companies yet.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Company</th><th>Contact</th><th>Phone</th><th>Email</th><th>Actions</th></tr></thead>
              <tbody>{companies.map((c:any) => <tr key={c.id}>
                <td><strong>{c.name}</strong></td><td>{c.contact_name ?? "—"}</td><td>{c.phone ?? "—"}</td><td>{c.email ?? "—"}</td>
                <td><CompanyEditForm company={{ id: c.id, name: c.name, contact_name: c.contact_name, phone: c.phone, email: c.email, notes: c.notes }} /></td>
              </tr>)}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </>
  );
}
