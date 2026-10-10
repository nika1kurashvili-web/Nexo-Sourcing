
// Order Excel: one row per product, a code (barcode / SKU) column and a quantity column.
export const MAX_ORDER_ROWS = 300;
export const MAX_ORDER_BYTES = 400_000;

// Self-contained (no imports) so the unit test can load it directly.
function parseQuantity(raw: string) {
  const text = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error("invalid");
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0.01 || value > 9999999) throw new Error("invalid");
  return value;
}

const simple = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const CODE_HEADERS = new Set(["barcode", "code", "codesku", "sku", "productcode", "itemcode", "ean"]);
const QTY_HEADERS = new Set(["quantity", "qty", "pcs", "amount", "count"]);

export type OrderImportLine = { line: number; code: string; quantity: number };
export type OrderImportParse = { lines: OrderImportLine[]; errors: string[]; warnings: string[] };

// Pure: turns raw sheet rows (first row = headers) into validated lines. Repeated codes are added together.
export function parseOrderSheet(sheet: string[][]): OrderImportParse {
  if (!sheet.length) return { lines: [], errors: ["The sheet is empty."], warnings: [] };
  const header = sheet[0].map(cell => simple(String(cell ?? "")));
  const codeColumn = header.findIndex(name => CODE_HEADERS.has(name));
  const qtyColumn = header.findIndex(name => QTY_HEADERS.has(name));
  if (codeColumn < 0 || qtyColumn < 0) {
    return { lines: [], errors: ['The first row must contain a "Barcode" column and a "Quantity" column.'], warnings: [] };
  }
  const problems: string[] = [];
  const warnings: string[] = [];
  const merged = new Map<string, OrderImportLine>();
  let rowCount = 0;
  for (let index = 1; index < sheet.length; index++) {
    const line = index + 1;
    const raw = sheet[index] ?? [];
    const code = String(raw[codeColumn] ?? "").trim();
    const qtyText = String(raw[qtyColumn] ?? "").trim();
    if (!code && !qtyText) continue;
    if (++rowCount > MAX_ORDER_ROWS) { problems.push(`More than ${MAX_ORDER_ROWS} rows. Split the file.`); break; }
    if (!code) { problems.push(`Row ${line}: the barcode is empty.`); continue; }
    if (code.length > 60) { problems.push(`Row ${line}: the barcode is longer than 60 characters.`); continue; }
    let quantity: number;
    try { quantity = parseQuantity(qtyText); }
    catch { problems.push(`Row ${line}: "${qtyText}" is not a valid quantity for ${code}.`); continue; }
    const key = code.toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      existing.quantity = Math.round((existing.quantity + quantity) * 100) / 100;
      warnings.push(`Barcode ${code} appears more than once (row ${existing.line} and ${line}); the quantities were added together.`);
    } else merged.set(key, { line, code, quantity });
  }
  return { lines: Array.from(merged.values()), errors: problems, warnings };
}
