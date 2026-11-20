// Company sell prices inside the product Excel sheet (pure helpers, no imports, so they can be unit-tested).
// Each company has two optional columns:  "Sell price: <Company name>"  and  "Sell currency: <Company name>".
// A filled price makes the product visible to that company at that price; an empty cell leaves things unchanged.

export type CompanyRef = { id: string; name: string };
export type CompanyColumn = { index: number; kind: "price" | "currency"; companyId: string };
export type CompanyPrice = { companyId: string; price: number; currency: string | null };

export const SELL_CURRENCIES = ["USD", "CNY", "EUR", "GEL"];

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

export const priceColumnLabel = (name: string) => `Sell price: ${name}`;
export const currencyColumnLabel = (name: string) => `Sell currency: ${name}`;

export function detectCompanyColumns(header: unknown[], companies: CompanyRef[]) {
  const byName = new Map<string, CompanyRef>();
  for (const company of companies) if (!byName.has(norm(company.name))) byName.set(norm(company.name), company);
  const columns: CompanyColumn[] = [];
  const unknownNames: string[] = [];
  const recognised = new Set<number>();
  header.forEach((cell, index) => {
    const match = /^\s*sell\s*(price|currency)\s*[:：]\s*(.+?)\s*$/i.exec(String(cell ?? ""));
    if (!match) return;
    recognised.add(index);
    const company = byName.get(norm(match[2]));
    if (!company) { if (!unknownNames.includes(match[2])) unknownNames.push(match[2]); return; }
    columns.push({ index, kind: match[1].toLowerCase() === "price" ? "price" : "currency", companyId: company.id });
  });
  return { columns, unknownNames, recognised };
}

// Reads the company cells of one sheet row. Returns an error message for the first invalid cell.
export function parseCompanyCells(raw: unknown[], columns: CompanyColumn[], companies: CompanyRef[]): { prices: CompanyPrice[]; error?: string } {
  const nameOf = (id: string) => companies.find(company => company.id === id)?.name ?? "company";
  const prices: CompanyPrice[] = [];
  for (const companyId of Array.from(new Set(columns.map(column => column.companyId)))) {
    const priceColumn = columns.find(column => column.companyId === companyId && column.kind === "price");
    const currencyColumn = columns.find(column => column.companyId === companyId && column.kind === "currency");
    let priceText = priceColumn ? String(raw[priceColumn.index] ?? "").trim() : "";
    if (priceText === "") continue;
    if (/^\d+,\d+$/.test(priceText)) priceText = priceText.replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(priceText) || Number(priceText) > 9999999) return { prices: [], error: `invalid sell price for ${nameOf(companyId)}` };
    let currency: string | null = null;
    const currencyText = currencyColumn ? String(raw[currencyColumn.index] ?? "").trim().toUpperCase() : "";
    if (currencyText !== "") {
      if (!SELL_CURRENCIES.includes(currencyText)) return { prices: [], error: `invalid sell currency for ${nameOf(companyId)} (use USD, CNY, EUR or GEL)` };
      currency = currencyText;
    }
    prices.push({ companyId, price: Number(priceText), currency });
  }
  return { prices };
}
