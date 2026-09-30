import Link from "next/link";
import { createRequestAction } from "@/app/actions";
import { requireSourcingAccess } from "@/lib/auth";
import { RequestBadge } from "@/components/RequestBadge";

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const { supabase } = await requireSourcingAccess();

  const [{ data: requestsData }, { data: companiesData }] = await Promise.all([
    supabase.from("sourcing_requests")
      .select("id, request_no, title, status, created_at, updated_at, sourcing_companies(name)")
      .order("updated_at", { ascending: false }),
    supabase.from("sourcing_companies").select("id, name").eq("active", true).order("name")
  ]);

  const requests = (requestsData ?? []) as any[];
  const companies = companiesData ?? [];

  return (
    <>
      <div className="page-head"><div><h1>Requests</h1><div className="muted">All company requests</div></div></div>
      {params.error && <div className="notice">Unable to create request.</div>}
      <div className="two-col">
        <div className="card">
          <h2>New Request</h2><hr />
          <form action={createRequestAction} className="form-grid">
            <label>Company
              <select name="company_id" defaultValue="">
                <option value="">— Select a company —</option>
                {companies.map((c:any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>Request Title<input name="title" placeholder="e.g. Kitchen supplies for a hotel" /></label>
            <label>Client Contact<input name="client_contact" /></label>
            <label>Notes<textarea name="notes" /></label>
            <button className="btn" type="submit">Create Request</button>
          </form>
        </div>
        <div className="card">
          <h2>All Requests ({requests.length})</h2><hr />
          {requests.length === 0 ? <div className="empty">No requests yet.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Request</th><th>Company</th><th>Title</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>{requests.map((r) => <tr key={r.id}>
                <td><Link className="row-link" href={`/requests/${r.id}`}>{r.request_no}</Link></td>
                <td>{r.sourcing_companies?.name ?? "—"}</td><td>{r.title ?? "—"}</td>
                <td><RequestBadge status={r.status} /></td>
                <td>{new Date(r.updated_at).toLocaleDateString("en-GB")}</td>
              </tr>)}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </>
  );
}
