import Link from "next/link";
import { requireSourcingAccess } from "@/lib/auth";
import { RequestBadge } from "@/components/RequestBadge";
import { RequestDeadline } from "@/components/RequestDeadline";
import { formatRequestDate } from "@/lib/request-dates";

export default async function DashboardPage() {
  const { supabase } = await requireSourcingAccess();
  const now = new Date();

  const [activeResult, waitingResult, answeredResult, quoteResult, requestsResult, deadlinesResult] =
    await Promise.all([
      supabase.from("sourcing_requests").select("*", { count: "exact", head: true })
        .not("status", "in", '("approved","rejected","cancelled")'),
      supabase.from("sourcing_request_items").select("*", { count: "exact", head: true })
        .in("supplier_status", ["sent", "waiting"]),
      supabase.from("sourcing_request_items").select("*", { count: "exact", head: true })
        .eq("supplier_status", "answered"),
      supabase.from("sourcing_requests").select("*", { count: "exact", head: true })
        .in("status", ["quote_sent", "waiting_client"]),
      supabase.from("sourcing_requests")
        .select("id, request_no, title, status, created_at, updated_at, sourcing_companies(name)")
        .order("updated_at", { ascending: false }).limit(8),
      supabase.from("sourcing_requests")
        .select("id, request_no, status, deadline_at, sourcing_companies(name)")
        .not("status", "in", '("approved","rejected","cancelled")')
        .gte("deadline_at", now.toISOString()).order("deadline_at", { ascending: true }).limit(5)
    ]);

  const requests = (requestsResult.data ?? []) as any[];
  const deadlines = (deadlinesResult.data ?? []) as any[];

  return (
    <>
      <div className="page-head">
        <div><h1>Dashboard</h1><div className="muted">All active requests in one place</div></div>
        <Link href="/requests" className="btn">+ New Request</Link>
      </div>

      <div className="grid-4">
        <div className="stat"><div className="muted small">Active Requests</div><div className="stat-value">{activeResult.count ?? 0}</div></div>
        <div className="stat"><div className="muted small">Waiting for Supplier</div><div className="stat-value">{waitingResult.count ?? 0}</div></div>
        <div className="stat"><div className="muted small">Response Received</div><div className="stat-value">{answeredResult.count ?? 0}</div></div>
        <div className="stat"><div className="muted small">Waiting for Client</div><div className="stat-value">{quoteResult.count ?? 0}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>Upcoming Deadlines</h2>
        <p className="small muted">Nearest active requests · Tbilisi time</p>
        {deadlinesResult.error ? <p className="muted">Deadlines unavailable. Check that the request deadline SQL migration has been applied.</p> :
          deadlines.length === 0 ? <p className="muted">No upcoming deadlines.</p> :
          <div className="table-wrap"><table>
            <thead><tr><th>Request</th><th>Company</th><th>Deadline</th><th>Status</th></tr></thead>
            <tbody>{deadlines.map(request => <tr key={request.id}>
              <td><Link className="row-link" href={`/requests/${request.id}`}>{request.request_no}</Link></td>
              <td>{request.sourcing_companies?.name ?? "—"}</td>
              <td><RequestDeadline value={request.deadline_at} status={request.status} now={now} /></td>
              <td><RequestBadge status={request.status} /></td>
            </tr>)}</tbody>
          </table></div>}
      </div>

      <div className="card">
        <div className="page-head"><div><h2>Recent Requests</h2></div></div>
        <p className="small muted">Dates shown in Tbilisi time.</p>
        {requests.length === 0 ? <div className="empty">No requests yet.</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Request</th><th>Company</th><th>Title</th><th>Created</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td><Link className="row-link" href={`/requests/${r.id}`}>{r.request_no}</Link></td>
                    <td>{r.sourcing_companies?.name ?? "—"}</td>
                    <td>{r.title ?? "—"}</td>
                    <td>{formatRequestDate(r.created_at)}</td>
                    <td><RequestBadge status={r.status} /></td>
                    <td>{formatRequestDate(r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
