export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const RESPONSE_STATUSES = ["waiting", "answered", "not_found"] as const;
export const RESPONSE_NUMBERS = [
  "china_price", "moq", "lead_time_days", "box_length_cm", "box_width_cm", "box_height_cm", "weight_kg"
] as const;
export const RESPONSE_FIELDS = [...RESPONSE_NUMBERS, "currency", "supplier_comment", "supplier_status"] as const;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function parseSupplierResponse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid response.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !(RESPONSE_FIELDS as readonly string[]).includes(key))) {
    throw new Error("This response contains fields you cannot edit.");
  }
  const result: Record<string, string | number | null> = {};
  for (const key of RESPONSE_NUMBERS) {
    const raw = input[key];
    if (raw === "" || raw === null) { result[key] = null; continue; }
    if (typeof raw !== "number" && (typeof raw !== "string" || !/^\d+(\.\d+)?$/.test(raw))) throw new Error(`Invalid ${key.replaceAll("_", " ")}.`);
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0 || number > 9999999 || (key === "lead_time_days" && !Number.isInteger(number))) {
      throw new Error(`Invalid ${key.replaceAll("_", " ")}.`);
    }
    result[key] = number;
  }
  if (!["USD", "CNY", "EUR", "GEL"].includes(String(input.currency))) throw new Error("Select a supported currency.");
  if (!(RESPONSE_STATUSES as readonly unknown[]).includes(input.supplier_status)) throw new Error("Select a response status.");
  if (input.supplier_comment !== null && typeof input.supplier_comment !== "string") throw new Error("Invalid supplier comment.");
  if (String(input.supplier_comment ?? "").length > 10000) throw new Error("Supplier comment must be 10,000 characters or fewer.");
  result.currency = String(input.currency);
  result.supplier_status = String(input.supplier_status);
  result.supplier_comment = String(input.supplier_comment ?? "").trim() || null;
  return result;
}

// Check bytes, not just the browser-provided MIME type. SVG/HTML is never served.
export function imageMime(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length < 12) return null;
  if ([137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}
