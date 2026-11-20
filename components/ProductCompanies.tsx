import { saveProductCompaniesAction } from "@/app/company-actions";

type Company = { id: string; name: string };
type Assignment = { company_id: string; sell_price: number | string | null; currency: string };

// Nexo only: which companies see this product in their portal, and at what sell price.
export function ProductCompanies({ productId, companies, assigned }: { productId: string; companies: Company[]; assigned: Assignment[] }) {
  const byCompany = new Map(assigned.map(row => [row.company_id, row]));
  if (companies.length === 0) return <div className="small muted">Add a company first (Companies page).</div>;
  return (
    <form action={saveProductCompaniesAction.bind(null, productId)} className="stack" style={{ gap: 8 }}>
      {companies.map(company => {
        const row = byCompany.get(company.id);
        return (
          <div key={company.id} className="company-assign">
            <label className="company-assign-name"><input type="checkbox" name={`use_${company.id}`} defaultChecked={!!row} /> {company.name}</label>
            <input name={`price_${company.id}`} defaultValue={row?.sell_price === null || row?.sell_price === undefined ? "" : String(Number(row.sell_price))} inputMode="decimal" placeholder="Sell price" aria-label={`Sell price for ${company.name}`} />
            <select name={`cur_${company.id}`} defaultValue={row?.currency ?? "GEL"} aria-label="Currency">
              {["GEL", "USD", "EUR", "CNY"].map(currency => <option key={currency} value={currency}>{currency}</option>)}
            </select>
          </div>
        );
      })}
      <div><button className="btn sm" type="submit">Save companies</button></div>
    </form>
  );
}
