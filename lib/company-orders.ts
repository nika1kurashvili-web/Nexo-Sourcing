// Pure helpers for company orders (no imports, so they can be unit-tested directly).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Quantity typed by a person: a positive number with at most 2 decimals. Returns null when empty or invalid.
export function parseQuantityText(value: unknown): number | null {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number > 0 && number <= 999999 ? number : null;
}

// Validates the list of lines sent by a company. Throws an Error with a message that is safe to show.
export function parseOrderLines(input: unknown, max = 100): { productId: string; quantity: number }[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Choose at least one product.");
  if (input.length > max) throw new Error(`An order can have at most ${max} products.`);
  const seen = new Set<string>();
  const lines: { productId: string; quantity: number }[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid order.");
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(key => key !== "productId" && key !== "quantity")) throw new Error("Invalid order.");
    if (typeof item.productId !== "string" || !UUID.test(item.productId) || seen.has(item.productId)) throw new Error("Invalid order.");
    const quantity = parseQuantityText(item.quantity);
    if (quantity === null) throw new Error("Enter a valid quantity for every product.");
    seen.add(item.productId);
    lines.push({ productId: item.productId, quantity });
  }
  return lines;
}

// Totals of an order, per currency (a company may be priced in more than one currency).
export function lineTotals(lines: { quantity: number; unit_price: number | null; currency: string }[]) {
  const byCurrency = new Map<string, number>();
  let unpriced = 0;
  let totalQuantity = 0;
  for (const line of lines) {
    totalQuantity += Number(line.quantity) || 0;
    if (line.unit_price === null || line.unit_price === undefined) { unpriced += 1; continue; }
    byCurrency.set(line.currency, (byCurrency.get(line.currency) ?? 0) + Number(line.quantity) * Number(line.unit_price));
  }
  return {
    byCurrency: Array.from(byCurrency, ([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 })),
    unpriced,
    totalQuantity: Math.round(totalQuantity * 100) / 100
  };
}

// ---- Payments ---------------------------------------------------------------------------------

export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "transfer", label: "Bank transfer" }, { value: "cash", label: "Cash" }, { value: "card", label: "Card" }, { value: "other", label: "Other" }
];
export const PAYMENT_CURRENCIES = ["GEL", "USD", "EUR", "CNY"];
export const paymentMethodLabel = (value: string) => PAYMENT_METHODS.find(method => method.value === value)?.label ?? value;

function realDate(text: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

// Validates a payment typed by a person. Throws an Error with a message that is safe to show.
export function parsePayment(input: { paidOn?: unknown; amount?: unknown; currency?: unknown; method?: unknown; note?: unknown }) {
  const paidOn = String(input.paidOn ?? "").trim();
  if (!realDate(paidOn)) throw new Error("Enter a valid payment date.");
  const amountText = String(input.amount ?? "").trim().replace(",", ".");
  const amount = /^\d+(\.\d{1,2})?$/.test(amountText) ? Number(amountText) : NaN;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999) throw new Error("Enter a valid amount.");
  const currency = String(input.currency ?? "");
  if (!PAYMENT_CURRENCIES.includes(currency)) throw new Error("Select a currency.");
  const method = String(input.method ?? "");
  if (!PAYMENT_METHODS.some(item => item.value === method)) throw new Error("Select how it was paid.");
  const note = String(input.note ?? "").trim().slice(0, 1000) || null;
  return { paidOn, amount, currency, method, note };
}

// Per currency: what the order costs, what was paid (confirmed only), what still waits for Nexo's confirmation, and the balance.
export function paymentSummary(
  lines: { quantity: number; unit_price: number | null; currency: string }[],
  payments: { amount: number | string; currency: string; status: string }[]
) {
  const total = new Map<string, number>();
  const paid = new Map<string, number>();
  const pending = new Map<string, number>();
  const add = (map: Map<string, number>, currency: string, value: number) => map.set(currency, (map.get(currency) ?? 0) + value);
  for (const line of lines) if (line.unit_price !== null && line.unit_price !== undefined) add(total, line.currency, Number(line.quantity) * Number(line.unit_price));
  for (const payment of payments) add(payment.status === "confirmed" ? paid : pending, payment.currency, Number(payment.amount));
  const currencies = Array.from(new Set([...total.keys(), ...paid.keys(), ...pending.keys()])).sort();
  const round = (value: number) => Math.round(value * 100) / 100;
  return currencies.map(currency => ({
    currency, total: round(total.get(currency) ?? 0), paid: round(paid.get(currency) ?? 0), pending: round(pending.get(currency) ?? 0),
    balance: round((total.get(currency) ?? 0) - (paid.get(currency) ?? 0))
  }));
}

// Profit of a company order (staff only): sell price minus the supplier's catalog price.
// A line counts only when both prices exist and are in the same currency; the rest is reported as "skipped".
export function lineProfit(line: { quantity: number; unit_price: number | null; currency: string }, cost: { price: number | null; currency: string | null } | undefined) {
  if (line.unit_price === null || !cost || cost.price === null || cost.currency !== line.currency) return null;
  const revenue = line.quantity * line.unit_price;
  const spent = line.quantity * cost.price;
  return { revenue, cost: spent, profit: revenue - spent };
}

export function profitSummary(lines: { quantity: number; unit_price: number | null; currency: string; cost?: { price: number | null; currency: string | null } }[]) {
  const byCurrency = new Map<string, { currency: string; revenue: number; cost: number; profit: number }>();
  let skipped = 0;
  for (const line of lines) {
    const result = lineProfit(line, line.cost);
    if (!result) { skipped++; continue; }
    const row = byCurrency.get(line.currency) ?? { currency: line.currency, revenue: 0, cost: 0, profit: 0 };
    row.revenue += result.revenue; row.cost += result.cost; row.profit += result.profit;
    byCurrency.set(line.currency, row);
  }
  return { byCurrency: Array.from(byCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency)), skipped };
}
