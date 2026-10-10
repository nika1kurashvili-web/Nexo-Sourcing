import { PRODUCT_NUMBERS, parseProductFields } from "@/lib/catalog-validation";

// Column layout of the product Excel sheet. The header row decides which columns are present,
// so a sheet with fewer columns only updates those columns.
export const SHEET_COLUMNS: { key: string; label: string; width: number; aliases?: string[] }[] = [
  { key: "sku", label: "Code (SKU)", width: 14, aliases: ["sku", "code", "productcode", "itemcode"] },
  { key: "name", label: "Name", width: 34, aliases: ["productname", "title"] },
  { key: "description", label: "Description", width: 40 },
  { key: "specifications", label: "Specifications", width: 40, aliases: ["specs", "specification"] },
  { key: "price", label: "Price", width: 10 },
  { key: "currency", label: "Currency", width: 10 },
  { key: "moq", label: "MOQ", width: 10 },
  { key: "lead_time_days", label: "Lead time (days)", width: 14, aliases: ["leadtime", "leadtimedays"] },
  { key: "box_length_cm", label: "Box length (cm)", width: 14, aliases: ["boxlength"] },
  { key: "box_width_cm", label: "Box width (cm)", width: 14, aliases: ["boxwidth"] },
  { key: "box_height_cm", label: "Box height (cm)", width: 14, aliases: ["boxheight"] },
  { key: "weight_kg", label: "Weight (kg)", width: 12, aliases: ["weight"] },
  { key: "qty_in_box", label: "Quantity in box", width: 14, aliases: ["qtyinbox", "quantityinbox", "pcsperbox"] },
  { key: "internal_note", label: "Internal note (Nexo only)", width: 30, aliases: ["internalnote", "note"] }
];

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 900_000;

const simple = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const HEADER_LOOKUP = new Map<string, string>();
for (const column of SHEET_COLUMNS) {
  HEADER_LOOKUP.set(simple(column.label), column.key);
  HEADER_LOOKUP.set(simple(column.key), column.key);
  for (const alias of column.aliases ?? []) HEADER_LOOKUP.set(simple(alias), column.key);
}

export type ImportRow = { line: number; sku: string | null; fields: Record<string, string | number | null> };
export type ImportParse = { columns: string[]; rows: ImportRow[]; errors: string[]; warnings: string[] };

export function exportRows(products: Record<string, any>[], supplierNames?: Map<string, string>) {
  const header = [...(supplierNames ? ["Supplier (info only)"] : []), ...SHEET_COLUMNS.map(column => column.label)];
  const rows = products.map(product => [
    ...(supplierNames ? [supplierNames.get(product.supplier_id) ?? ""] : []),
    ...SHEET_COLUMNS.map(column => {
      const value = product[column.key];
      if (value === null || value === undefined) return null;
      return PRODUCT_NUMBERS.includes(column.key as never) ? Number(value) : String(value);
    })
  ]);
  return [header, ...rows];
}

// Turns raw sheet rows (first row = headers) into validated product rows. Pure and side-effect free.
export function parseProductSheet(sheet: string[][]): ImportParse {
  const warnings: string[] = [];
  if (!sheet.length) return { columns: [], rows: [], errors: ["The sheet is empty."], warnings: [] };
  const header = sheet[0].map(cell => HEADER_LOOKUP.get(simple(String(cell ?? ""))) ?? null);
  const columns = Array.from(new Set(header.filter((key): key is string => !!key)));
  if (!columns.includes("name")) return { columns, rows: [], errors: ['The first row must contain a "Name" column.'], warnings: [] };
  const unknown = sheet[0].filter((cell, index) => String(cell ?? "").trim() && !header[index]);
  if (unknown.length) warnings.push(`Ignored unknown column(s): ${unknown.slice(0, 5).join(", ")}.`);

  const rows: ImportRow[] = [];
  const seen = new Map<string, number>();
  const problems: string[] = [];
  for (let index = 1; index < sheet.length; index++) {
    const line = index + 1;
    const raw = sheet[index] ?? [];
    if (raw.every(cell => !String(cell ?? "").trim())) continue;
    if (rows.length >= MAX_IMPORT_ROWS) { problems.push(`More than ${MAX_IMPORT_ROWS} rows. Split the file.`); break; }
    const input: Record<string, unknown> = {};
    header.forEach((key, column) => {
      if (!key || key === "sku") return;
      let value = String(raw[column] ?? "").trim();
      // Excel in some regions stores decimals as text with a comma.
      if ((PRODUCT_NUMBERS as readonly string[]).includes(key) && /^\d+,\d+$/.test(value)) value = value.replace(",", ".");
      if (key === "currency") value = value.toUpperCase();
      input[key] = value;
    });
    let fields;
    try { fields = parseProductFields(input, { staff: true }); }
    catch (error) { problems.push(`Row ${line}: ${error instanceof Error ? error.message : "invalid data"}`); continue; }
    // Keep only columns present in the sheet (plus name), so absent columns are never wiped.
    const kept: Record<string, string | number | null> = { name: fields.name };
    for (const key of columns) if (key !== "sku" && key in fields) kept[key] = fields[key];

    let sku: string | null = null;
    const skuColumn = header.indexOf("sku");
    if (skuColumn >= 0) {
      const text = String(raw[skuColumn] ?? "").trim();
      if (text) {
        if (text.length > 60) { problems.push(`Row ${line}: the code is longer than 60 characters.`); continue; }
        const lower = text.toLowerCase();
        if (seen.has(lower)) { problems.push(`Row ${line}: the code "${text}" is already used in row ${seen.get(lower)}.`); continue; }
        seen.set(lower, line);
        sku = text;
      }
    }
    rows.push({ line, sku, fields: kept });
  }
  return { columns, rows, errors: problems, warnings };
}
