import { INVALID_COMPANY_LINK, readCompanyCatalog } from "@/lib/company-portal";
import { CompanySession } from "@/components/CompanySession";
import { CompanyNav } from "@/components/CompanyNav";
import { CompanyCatalog } from "@/components/CompanyCatalog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CompanyProductsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data;
  try { data = await readCompanyCatalog(token); }
  catch { return <p className="card">{INVALID_COMPANY_LINK}</p>; }
  return (
    <CompanySession token={token}>
      <CompanyNav token={token} active="products" companyName={data.companyName} />
      <CompanyCatalog token={token} products={data.products} />
    </CompanySession>
  );
}
