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
