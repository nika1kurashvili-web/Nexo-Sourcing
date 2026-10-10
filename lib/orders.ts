// Pure helpers shared by pages, actions and tests. No server-only imports here.
export const ORDER_STATUSES = ["draft", "sent", "confirmed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_CURRENCIES = ["USD", "CNY", "EUR", "GEL"] as const;

export const STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Draft", sent: "Sent to supplier", confirmed: "Confirmed", cancelled: "Cancelled"
};

export type OrderLine = { quantity: number | string; unit_price: number | string | null; proposed_price?: number | string | null };

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function lineTotal(quantity: unknown, price: unknown): number | null {
  if (price === null || price === undefined || price === "") return null;
  const q = Number(quantity), p = Number(price);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return null;
  return cents(q * p);
}

// total counts only prices Nexo approved. proposedTotal shows what the total would be if
// every supplier proposal were approved (proposal wins over the approved price on a line).
export function orderTotals(lines: OrderLine[], paidAmounts: (number | string)[]) {
  let total = 0, proposedTotal = 0, unpriced = 0, proposals = 0;
  for (const line of lines) {
    const approved = lineTotal(line.quantity, line.unit_price);
    const proposed = lineTotal(line.quantity, line.proposed_price);
    if (approved === null) unpriced++;
    if (proposed !== null) proposals++;
    total += approved ?? 0;
    proposedTotal += proposed ?? approved ?? 0;
  }
  const paid = cents(paidAmounts.reduce<number>((sum, amount) => sum + Number(amount || 0), 0));
  total = cents(total);
  return { total, proposedTotal: cents(proposedTotal), paid, balance: cents(total - paid), unpriced, proposals };
}

export function money(value: number | string | null | undefined, currency: string) {
  if (value === null || value === undefined || value === "") return "—";
  return `${currency} ${Number(value).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

// "" -> null, otherwise a finite number in range. Throws a readable error.
export function parseAmount(raw: unknown, label: string, opts: { min?: number; max?: number; allowEmpty?: boolean } = {}) {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (text === "") {
    if (opts.allowEmpty) return null;
    throw new Error(`Enter ${label}.`);
  }
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid ${label}.`);
  const value = Number(text);
  const min = opts.min ?? 0, max = opts.max ?? 9999999;
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}.`);
  return value;
}

export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export function validDate(text: string) {
  if (!DATE_PATTERN.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}
