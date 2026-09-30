import { createCompanyAction } from "@/app/actions";
import { requireSourcingAccess } from "@/lib/auth";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const { supabase } = await requireSourcingAccess();
  const { data } = await supabase.from("sourcing_companies").select("*").order("name");
  const companies = data ?? [];

  return (
    <>
      <div className="page-head"><div><h1>Companies</h1><div className="muted">კლიენტი კომპანიები</div></div></div>
      {params.error && <div className="notice">კომპანიის დამატება ვერ მოხერხდა.</div>}
      <div className="two-col">
        <div className="card">
          <h2>ახალი კომპანია</h2><hr />
          <form action={createCompanyAction} className="form-grid">
            <label>კომპანიის სახელი *<input name="name" required /></label>
            <label>საკონტაქტო პირი<input name="contact_name" /></label>
            <label>ტელეფონი<input name="phone" /></label>
            <label>Email<input name="email" type="email" /></label>
            <label>შენიშვნა<textarea name="notes" /></label>
            <button className="btn" type="submit">დამატება</button>
          </form>
        </div>
        <div className="card">
          <h2>კომპანიები ({companies.length})</h2><hr />
          {companies.length === 0 ? <div className="empty">ჯერ კომპანია არ არის დამატებული.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>კომპანია</th><th>საკონტაქტო</th><th>ტელეფონი</th><th>Email</th></tr></thead>
              <tbody>{companies.map((c:any) => <tr key={c.id}>
                <td><strong>{c.name}</strong></td><td>{c.contact_name ?? "—"}</td><td>{c.phone ?? "—"}</td><td>{c.email ?? "—"}</td>
              </tr>)}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </>
  );
}
