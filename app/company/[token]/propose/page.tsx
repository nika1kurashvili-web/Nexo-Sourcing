import { INVALID_COMPANY_LINK, readCompanyProposals } from "@/lib/company-portal";
import { CompanySession } from "@/components/CompanySession";
import { CompanyNav } from "@/components/CompanyNav";
import { CompanyPropose } from "@/components/CompanyPropose";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CompanyProposePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data;
  try { data = await readCompanyProposals(token); }
  catch { return <p className="card">{INVALID_COMPANY_LINK}</p>; }
  return (
    <CompanySession token={token}>
      <CompanyNav token={token} active="propose" companyName={data.companyName} />
      <CompanyPropose token={token} />
      {data.proposals.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2 style={{ marginTop: 0 }}>Your suggestions</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Product</th><th>Sent</th><th>Status</th></tr></thead>
            <tbody>{data.proposals.map(proposal => (
              <tr key={proposal.id}>
                <td>{proposal.name}</td>
                <td>{new Date(proposal.created_at).toLocaleDateString("en-GB", { timeZone: "Asia/Tbilisi" })}</td>
                <td><span className={`badge ${proposal.status === "handled" ? "success" : "warning"}`}>{proposal.status === "handled" ? "Reviewed by Nexo" : "Waiting for Nexo"}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </CompanySession>
  );
}
