import { UUID_PATTERN } from "@/lib/supplier-validation";

export { UUID_PATTERN };

export const CURRENCIES = ["USD", "CNY", "EUR", "GEL"] as const;
export const PRODUCT_TEXT = ["name", "description", "specifications"] as const;
export const PRODUCT_NUMBERS = [
  "price", "moq", "lead_time_days", "box_length_cm", "box_width_cm", "box_height_cm", "weight_kg"
] as const;
// Fields a supplier may submit. Staff additionally have `internal_note`.
export const PRODUCT_FIELDS = [...PRODUCT_TEXT, "currency", ...PRODUCT_NUMBERS] as const;
export const MAX_PRODUCT_IMAGES = 10;
export const MAX_TEXT = 5000;

export type ProductValues = Record<string, string | number | null>;

function label(key: string) {
  return key.replaceAll("_", " ");
}

// Validates and normalises product data coming from a form or JSON body.
// Unknown keys are rejected so a supplier can never smuggle in status/supplier/internal fields.
export function parseProductFields(value: unknown, options: { staff?: boolean } = {}): ProductValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid product.");
  const input = value as Record<string, unknown>;
  const allowed: readonly string[] = options.staff ? [...PRODUCT_FIELDS, "internal_note"] : PRODUCT_FIELDS;
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error("This product contains fields you cannot edit.");

  const result: ProductValues = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new Error("Product name is required.");
  if (name.length > 200) throw new Error("Product name must be 200 characters or fewer.");
  result.name = name;

  for (const key of options.staff ? ["description", "specifications", "internal_note"] : ["description", "specifications"]) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === "") { result[key] = null; continue; }
    if (typeof raw !== "string") throw new Error(`Invalid ${label(key)}.`);
    if (raw.length > MAX_TEXT) throw new Error(`${label(key)} must be ${MAX_TEXT} characters or fewer.`);
    result[key] = raw.trim() || null;
  }

  for (const key of PRODUCT_NUMBERS) {
    const raw = input[key];
    if (raw === undefined || raw === "" || raw === null) { result[key] = null; continue; }
    if (typeof raw !== "number" && (typeof raw !== "string" || !/^\d+(\.\d+)?$/.test(raw.trim()))) {
      throw new Error(`Invalid ${label(key)}.`);
    }
    const number = Number(typeof raw === "string" ? raw.trim() : raw);
    if (!Number.isFinite(number) || number < 0 || number > 9999999 || (key === "lead_time_days" && !Number.isInteger(number))) {
      throw new Error(`Invalid ${label(key)}.`);
    }
    result[key] = number;
  }

  const currency = input.currency === undefined || input.currency === "" ? "USD" : input.currency;
  if (!(CURRENCIES as readonly unknown[]).includes(currency)) throw new Error("Select a supported currency.");
  result.currency = String(currency);
  return result;
}

// Reads the catalog fields out of a browser form.
export function productInputFromForm(form: FormData, options: { staff?: boolean } = {}) {
  const input: Record<string, unknown> = {};
  const keys: readonly string[] = options.staff ? [...PRODUCT_FIELDS, "internal_note"] : PRODUCT_FIELDS;
  for (const key of keys) {
    const raw = form.get(key);
    if (raw !== null) input[key] = typeof raw === "string" ? raw : "";
  }
  return input;
}
