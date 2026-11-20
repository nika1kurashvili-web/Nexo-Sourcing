"use server";

import { randomBytes, createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { companyLinkUrl, encryptShareToken } from "@/lib/share-link-crypto";

// Every action runs requireSourcingAccess() first (staff only) and uses the server-only service client.

const CURRENCIES = ["USD", "CNY", "EUR", "GEL"];

export async function createCompanyLinkAction(companyId: string) {
  const { user } = await requireSourcingAccess();
  try {
    if (!UUID_PATTERN.test(companyId)) return { error: "Invalid company." };
    const db = adminDb();
    const { data: company } = await db.from("sourcing_companies").select("id").eq("id", companyId).maybeSingle();
    if (!company) return { error: "Company not found." };
    const token = randomBytes(32).toString("hex");
    const { data, error } = await db.from("sourcing_company_links").insert({
      company_id: companyId, token_hash: createHash("sha256").update(token).digest("hex"),
      token_encrypted: encryptShareToken(token), created_by: user.id
    }).select("id").single();
    if (error || !data) return { error: "Unable to create the link. Revoke the active link for this company first, or run the 20261017 migration." };
    revalidatePath("/companies");
    return { id: data.id as string, url: companyLinkUrl(token) };
  } catch (error) {
    return { error: error instanceof Error && error.message ? error.message : "Unable to create the link." };
  }
}

export async function revokeCompanyLinkAction(companyId: string, linkId: string) {
  await requireSourcingAccess();
  try {
    if (!UUID_PATTERN.test(companyId) || !UUID_PATTERN.test(linkId)) return { error: "Invalid link." };
    const db = adminDb();
    const { error } = await db.from("sourcing_company_links").update({ active: false, revoked_at: new Date().toISOString() })
      .eq("id", linkId).eq("company_id", companyId).eq("active", true);
    if (error) return { error: "Unable to revoke the link. Please try again." };
    revalidatePath("/companies");
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error && error.message ? error.message : "Unable to revoke the link." };
  }
}

function fail(message: string): never {
  redirect(`/products?company_error=${encodeURIComponent(message)}`);
}

// Saves which companies can see a product and the sell price for each of them (bound: productId first).
export async function saveProductCompaniesAction(productId: string, formData: FormData) {
  await requireSourcingAccess();
  if (!UUID_PATTERN.test(productId)) redirect("/products");
  const db = adminDb();
  const { data: companies, error: companiesError } = await db.from("sourcing_companies").select("id");
  if (companiesError) fail("Unable to load the companies.");
  const rows: { product_id: string; company_id: string; sell_price: number | null; currency: string }[] = [];
  for (const company of companies ?? []) {
    if (!formData.get(`use_${company.id}`)) continue;
    const priceText = String(formData.get(`price_${company.id}`) ?? "").trim().replace(",", ".");
    let sellPrice: number | null = null;
    if (priceText !== "") {
      if (!/^\d+(\.\d+)?$/.test(priceText) || Number(priceText) > 9999999) fail("Enter a valid sell price.");
      sellPrice = Number(priceText);
    }
    const currency = String(formData.get(`cur_${company.id}`) ?? "GEL");
    rows.push({ product_id: productId, company_id: company.id, sell_price: sellPrice, currency: CURRENCIES.includes(currency) ? currency : "GEL" });
  }
  if (rows.length) {
    const { error } = await db.from("sourcing_company_products").upsert(rows, { onConflict: "product_id,company_id" });
    if (error) fail("Unable to save the companies. Run supabase/migrations/20261017_company_portal.sql first.");
  }
  let removal = db.from("sourcing_company_products").delete().eq("product_id", productId);
  if (rows.length) removal = removal.not("company_id", "in", `(${rows.map(row => row.company_id).join(",")})`);
  const { error: removeError } = await removal;
  if (removeError) fail("Unable to save the companies.");
  revalidatePath("/products");
}

export async function setCompanyOrderStatusById(orderId: string, status: string) {
  await requireSourcingAccess();
  if (!UUID_PATTERN.test(orderId) || !["new", "accepted", "cancelled"].includes(status)) redirect("/company-orders");
  const db = adminDb();
  await db.from("sourcing_company_orders").update({ status }).eq("id", orderId);
  revalidatePath("/company-orders");
}

export async function setProposalHandledById(proposalId: string, handled: boolean) {
  await requireSourcingAccess();
  if (!UUID_PATTERN.test(proposalId)) redirect("/company-orders");
  const db = adminDb();
  await db.from("sourcing_company_proposals").update({ status: handled ? "handled" : "new" }).eq("id", proposalId);
  revalidatePath("/company-orders");
}
