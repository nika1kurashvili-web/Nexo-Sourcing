import Link from "next/link";
import { requireSourcingAccess } from "@/lib/auth";
import { RequestBadge } from "@/components/RequestBadge";

export default async function DashboardPage() {
  const { supabase } = await requireSourcingAccess();

  const [activeResult, waitingResult, answeredResult, quoteResult, requestsResult] =
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
        .select("id, request_no, title, status, updated_at, sourcing_companies(name)")
        .order("updated_at", { ascending: false }).limit(8)
    ]);

  const requests = (requestsResult.data ?? []) as any[];

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

      <div className="card">
        <div className="page-head"><div><h2>Recent Requests</h2></div></div>
        {requests.length === 0 ? <div className="empty">No requests yet.</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Request</th><th>Company</th><th>Title</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td><Link className="row-link" href={`/requests/${r.id}`}>{r.request_no}</Link></td>
                    <td>{r.sourcing_companies?.name ?? "—"}</td>
                    <td>{r.title ?? "—"}</td>
                    <td><RequestBadge status={r.status} /></td>
                    <td>{new Date(r.updated_at).toLocaleDateString("en-GB")}</td>
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
