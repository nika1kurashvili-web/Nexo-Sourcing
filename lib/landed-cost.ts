// Landed cost of one piece in GEL (Nexo-only information). Pure: no imports, so it can be unit tested.
//
//   price in GEL  = CNY: price × markup ÷ cny_per_gel      USD: price × markup × usd_gel      GEL: price
//   transport     = the larger of
//                     volume: (L×W×H cm ÷ 1,000,000) ÷ qty_in_box × usd_per_m3 × usd_gel
//                     weight: weight_kg ÷ qty_in_box × usd_per_kg × usd_gel
//   customs       = (price in GEL + transport) × customs
//   cost          = price in GEL + transport + customs

// Each shipping method (land / air) has its own set of numbers.
export type CostParams = {
  markup: number; cny_per_gel: number; usd_gel: number; usd_per_m3: number; usd_per_kg: number; customs: number;
};
export type ShippingMethod = "land" | "air";
export type CostSettings = Record<ShippingMethod, CostParams>;

export const SHIPPING_METHODS: { value: ShippingMethod; label: string }[] = [
  { value: "land", label: "Land (სახმელეთო)" },
  { value: "air", label: "Air (საჰაერო)" }
];

const LAND_DEFAULTS: CostParams = { markup: 1.03, cny_per_gel: 2.49, usd_gel: 2.65, usd_per_m3: 270, usd_per_kg: 1.1, customs: 0.18 };
export const COST_DEFAULTS: CostSettings = { land: { ...LAND_DEFAULTS }, air: { ...LAND_DEFAULTS } };

// Settings are stored as key/value rows: land keys are plain, air keys have the "air_" prefix.
export const settingKey = (method: ShippingMethod, key: keyof CostParams) => (method === "air" ? `air_${key}` : key);

export function normalizeShipping(value: unknown): ShippingMethod {
  return String(value ?? "").toLowerCase() === "air" ? "air" : "land";
}

export const COST_FIELDS: { key: keyof CostParams; label: string; hint: string }[] = [
  { key: "markup", label: "Price coefficient (CNY and USD prices)", hint: "1.03" },
  { key: "cny_per_gel", label: "CNY ÷ this number = GEL", hint: "2.49" },
  { key: "usd_gel", label: "USD × this number = GEL", hint: "2.65" },
  { key: "usd_per_m3", label: "Transport: USD per cubic metre", hint: "270" },
  { key: "usd_per_kg", label: "Transport: USD per kg", hint: "1.1" },
  { key: "customs", label: "Customs rate (0.18 = 18%)", hint: "0.18" }
];

export type CostResult =
  | { ok: true; method: ShippingMethod; total: number; price: number; transport: number; customs: number; basis: "volume" | "weight"; volume: number | null; weight: number | null }
  | { ok: false; reason: string };

const positive = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

export function computeCost(
  product: { shipping_method?: unknown; price?: unknown; currency?: unknown; qty_in_box?: unknown; weight_kg?: unknown; box_length_cm?: unknown; box_width_cm?: unknown; box_height_cm?: unknown },
  allSettings: CostSettings
): CostResult {
  const method = normalizeShipping(product.shipping_method);
  const settings = allSettings[method];
  const price = positive(product.price);
  if (price === null) return { ok: false, reason: "Set the price" };
  const currency = String(product.currency ?? "").toUpperCase();
  let priceGel: number;
  if (currency === "CNY") priceGel = price * settings.markup / settings.cny_per_gel;
  else if (currency === "USD") priceGel = price * settings.markup * settings.usd_gel;
  else if (currency === "GEL") priceGel = price;
  else return { ok: false, reason: `No formula for ${currency || "this currency"}` };

  const qty = positive(product.qty_in_box);
  if (qty === null) return { ok: false, reason: "Set Qty in box" };
  const length = positive(product.box_length_cm), width = positive(product.box_width_cm), height = positive(product.box_height_cm);
  const kg = positive(product.weight_kg);
  const volume = length && width && height ? (length * width * height / 1_000_000) / qty * settings.usd_per_m3 * settings.usd_gel : null;
  const weight = kg ? kg / qty * settings.usd_per_kg * settings.usd_gel : null;
  if (volume === null && weight === null) return { ok: false, reason: "Set box size or weight" };

  const useVolume = volume !== null && (weight === null || volume >= weight);
  const transport = useVolume ? (volume as number) : (weight as number);
  const customs = (priceGel + transport) * settings.customs;
  return { ok: true, method, total: priceGel + transport + customs, price: priceGel, transport, customs, basis: useVolume ? "volume" : "weight", volume, weight };
}
