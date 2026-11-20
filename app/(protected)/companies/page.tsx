import { createCompanyAction } from "@/app/actions";
import { requireSourcingAccess } from "@/lib/auth";
import { CompanyEditForm } from "@/components/CompanyEditForm";
import { CompanyLinkControls } from "@/components/CompanyLinkControls";
import { adminDb } from "@/lib/admin-db";
import { companyLinkUrl, decryptShareToken } from "@/lib/share-link-crypto";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const { supabase } = await requireSourcingAccess();
  const { data } = await supabase.from("sourcing_companies").select("*").order("name");
  const companies = data ?? [];

  // Portal links (the tables are closed to browser clients, so they are read with the server key).
  const linkByCompany = new Map<string, { id: string; url: string | null }>();
  let linksMissing = false;
  try {
    const { data: links, error } = await adminDb().from("sourcing_company_links").select("id,company_id,token_encrypted").eq("active", true);
    if (error) linksMissing = true;
    for (const link of links ?? []) {
      const token = decryptShareToken(link.token_encrypted);
      linkByCompany.set(link.company_id, { id: link.id, url: token ? companyLinkUrl(token) : null });
    }
  } catch { linksMissing = true; }

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
      <details className="card" style={{ marginTop: 14 }}>
        <summary>Company portal links ({linkByCompany.size} active)</summary>
        <p className="small muted">Give a company its link: it sees only the products you marked for it (with your sell price, never the supplier), can send you orders and suggest new products. In Products, open a product's "Companies &amp; sell price" to choose who sees it.</p>
        {linksMissing && <div className="notice">Run supabase/migrations/20261017_company_portal.sql in the Supabase SQL Editor to enable company links.</div>}
        <div className="stack">
          {companies.map((company: any) => <CompanyLinkControls key={company.id} company={{ id: company.id, name: company.name }} link={linkByCompany.get(company.id) ?? null} />)}
          {companies.length === 0 && <div className="muted">Add a company first.</div>}
        </div>
      </details>
    </>
  );
}
