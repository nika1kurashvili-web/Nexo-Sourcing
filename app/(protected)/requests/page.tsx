import Link from "next/link";
import { createRequestAction } from "@/app/actions";
import { requireSourcingAccess } from "@/lib/auth";
import { RequestBadge } from "@/components/RequestBadge";
import { RequestDeadline } from "@/components/RequestDeadline";
import { DeadlineField } from "@/components/DeadlineField";
import { formatRequestDate } from "@/lib/request-dates";

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const { supabase } = await requireSourcingAccess();

  const [requestsResult, { data: companiesData }] = await Promise.all([
    supabase.from("sourcing_requests")
      .select("id, request_no, title, status, created_at, deadline_at, updated_at, sourcing_companies(name)")
      .order("updated_at", { ascending: false }),
    supabase.from("sourcing_companies").select("id, name").eq("active", true).order("name")
  ]);

  const deadlineSetupPending = requestsResult.error?.code === "42703" || requestsResult.error?.code === "PGRST204";
  // Keep the existing list usable during deployment before SQL is applied.
  const legacyResult = deadlineSetupPending ? await supabase.from("sourcing_requests")
    .select("id, request_no, title, status, created_at, updated_at, sourcing_companies(name)")
    .order("updated_at", { ascending: false }) : null;
  const requests = (legacyResult?.data ?? requestsResult.data ?? []) as any[];
  const companies = companiesData ?? [];
  const now = new Date();

  return (
    <>
      <div className="page-head"><div><h1>Requests</h1><div className="muted">All company requests</div></div></div>
      {params.error && <div className="notice">{params.error === "deadline" ? "Enter a valid deadline date and time." : "Unable to create request."}</div>}
      {deadlineSetupPending && <div className="notice">Deadline setup pending. Apply the request deadline SQL migration to enable deadlines.</div>}
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
            <DeadlineField disabled={deadlineSetupPending} />
            <button className="btn" type="submit">Create Request</button>
          </form>
        </div>
        <div className="card">
          <h2>All Requests ({requests.length})</h2><hr />
          <p className="small muted">Dates shown in Tbilisi time.</p>
          {requests.length === 0 ? <div className="empty">No requests yet.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Request</th><th>Company</th><th>Title</th><th>Created</th><th>Deadline</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>{requests.map((r) => <tr key={r.id}>
                <td><Link className="row-link" href={`/requests/${r.id}`}>{r.request_no}</Link></td>
                <td>{r.sourcing_companies?.name ?? "—"}</td><td>{r.title ?? "—"}</td>
                <td>{formatRequestDate(r.created_at)}</td>
                <td><RequestDeadline value={r.deadline_at} status={r.status} now={now} /></td>
                <td><RequestBadge status={r.status} /></td>
                <td>{formatRequestDate(r.updated_at)}</td>
              </tr>)}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </>
  );
}
