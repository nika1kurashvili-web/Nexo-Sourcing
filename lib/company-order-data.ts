import "server-only";
import { BUCKET } from "@/lib/supplier-portal";
import { COST_DEFAULTS, COST_FIELDS, SHIPPING_METHODS, computeCost, settingKey, type CostSettings } from "@/lib/landed-cost";

// Staff-only helpers for the company order pages (they use the service client and signed links).

// First ready photo of each product as a short-lived signed link, in two round trips.
export async function photoUrlsFor(db: any, productIds: (string | null | undefined)[]) {
  const urls = new Map<string, string>();
  const ids = Array.from(new Set(productIds.filter((value): value is string => !!value)));
  if (!ids.length) return urls;
  const { data: photos } = await db.from("sourcing_product_images").select("product_id,object_path,created_at")
    .eq("ready", true).in("product_id", ids).order("created_at");
  const firstPerProduct = new Map<string, string>();
  for (const photo of photos ?? []) if (!firstPerProduct.has(photo.product_id)) firstPerProduct.set(photo.product_id, photo.object_path);
  const paths = Array.from(firstPerProduct.values());
  if (!paths.length) return urls;
  const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(paths, 3600);
  const urlByPath = new Map<string, string>();
  paths.forEach((path, index) => { if (signed?.[index]?.signedUrl) urlByPath.set(path, signed[index].signedUrl); });
  firstPerProduct.forEach((path, productId) => { const url = urlByPath.get(path); if (url) urls.set(productId, url); });
  return urls;
}

// Landed cost per piece in GEL for each product (same numbers as the Products page), plus the land-transport rates.
export async function loadCosts(db: any, productIds: (string | null | undefined)[]) {
  const ids = Array.from(new Set(productIds.filter((value): value is string => !!value)));
  const [products, settingsResult] = await Promise.all([
    ids.length
      ? db.from("sourcing_products").select("id,price,currency,shipping_method,qty_in_box,weight_kg,box_length_cm,box_width_cm,box_height_cm").in("id", ids)
      : Promise.resolve({ data: [] as any[] }),
    db.from("sourcing_settings").select("key,value")
  ]);
  const settings: CostSettings = { land: { ...COST_DEFAULTS.land }, air: { ...COST_DEFAULTS.air } };
  const stored = new Map<string, number>((settingsResult.data ?? []).map((row: any) => [row.key as string, Number(row.value)]));
  for (const method of SHIPPING_METHODS) for (const field of COST_FIELDS) {
    const value = stored.get(settingKey(method.value, field.key));
    if (value !== undefined && Number.isFinite(value)) settings[method.value][field.key] = value;
  }
  const costOf = new Map<string, number | null>();
  const costReason = new Map<string, string>();
  for (const row of products.data ?? []) {
    const result = computeCost(row, settings);
    costOf.set(row.id as string, result.ok ? result.total : null);
    if (!result.ok) costReason.set(row.id as string, result.reason);
  }
  return { costOf, costReason, rates: { usd_gel: settings.land.usd_gel, cny_per_gel: settings.land.cny_per_gel } };
}
