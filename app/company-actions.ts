"use server";

import { randomBytes, createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { companyLinkUrl, encryptShareToken } from "@/lib/share-link-crypto";
import { parsePayment } from "@/lib/company-orders";
import { BUCKET } from "@/lib/supplier-portal";

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

// ---- Nexo approves a company's product suggestion: it becomes a normal product in Products -----------------

const UNASSIGNED_SUPPLIER = "Unassigned (from companies)";

function proposalFail(message: string): never {
  redirect("/company-orders?error=" + encodeURIComponent(message));
}

export async function approveProposalAction(proposalId: string, formData: FormData) {
  const { user } = await requireSourcingAccess();
  if (!UUID_PATTERN.test(proposalId)) redirect("/company-orders");
  const db = adminDb();
  const { data: proposal, error } = await db.from("sourcing_company_proposals")
    .select("id,company_id,name,description,link,quantity,product_id,sourcing_companies(name),sourcing_company_proposal_images(id,object_path,mime_type)")
    .eq("id", proposalId).maybeSingle();
  if (error) proposalFail("Unable to approve. Run supabase/migrations/20261020_proposal_product.sql in the Supabase SQL Editor first.");
  if (!proposal) proposalFail("Suggestion not found.");
  if (proposal.product_id) proposalFail("This suggestion is already in Products.");

  // The supplier is optional: without one the product goes to a placeholder supplier that can be changed later in Products.
  let supplierId = String(formData.get("supplier_id") ?? "").trim();
  if (supplierId) {
    if (!UUID_PATTERN.test(supplierId)) proposalFail("Choose a valid supplier.");
    const { data: supplier } = await db.from("sourcing_suppliers").select("id").eq("id", supplierId).maybeSingle();
    if (!supplier) proposalFail("Supplier not found.");
  } else {
    const found = await db.from("sourcing_suppliers").select("id").eq("name", UNASSIGNED_SUPPLIER).limit(1).maybeSingle();
    if (found.data) supplierId = found.data.id as string;
    else {
      const created = await db.from("sourcing_suppliers").insert({ name: UNASSIGNED_SUPPLIER, notes: "Placeholder for products approved from company suggestions. Change the supplier in Products." }).select("id").single();
      if (created.error || !created.data) proposalFail("Unable to create the placeholder supplier. Choose a supplier instead.");
      supplierId = created.data.id as string;
    }
  }

  const companyName = proposal.sourcing_companies?.name ?? "a company";
  const note = [`Suggested by ${companyName}`, proposal.link ? `Link: ${proposal.link}` : null, proposal.quantity ? `Wanted: ${Number(proposal.quantity)} pcs` : null].filter(Boolean).join("\n");
  const now = new Date().toISOString();
  const inserted = await db.from("sourcing_products").insert({
    supplier_id: supplierId, name: proposal.name, description: proposal.description ?? null, internal_note: note,
    status: "approved", created_by_supplier: false, created_by: user.id, approved_by: user.id, approved_at: now
  }).select("id,sku").single();
  if (inserted.error || !inserted.data) proposalFail("Unable to create the product.");
  const productId = inserted.data.id as string;

  // Copy the company's photos into the product's photos (best effort: the product exists either way).
  let failedPhotos = 0;
  for (const image of proposal.sourcing_company_proposal_images ?? []) {
    const imageId = randomUUID();
    const path = `catalog/${supplierId}/${productId}/${imageId}`;
    const download = await db.storage.from(BUCKET).download(image.object_path);
    if (download.error || !download.data) { failedPhotos++; continue; }
    const bytes = new Uint8Array(await download.data.arrayBuffer());
    if (!bytes.byteLength) { failedPhotos++; continue; }
    const upload = await db.storage.from(BUCKET).upload(path, bytes, { contentType: image.mime_type, upsert: false });
    if (upload.error) { failedPhotos++; continue; }
    const row = await db.from("sourcing_product_images").insert({
      id: imageId, product_id: productId, supplier_id: supplierId, object_path: path, mime_type: image.mime_type,
      byte_size: bytes.byteLength, ready: true, approved: true, uploaded_by_supplier: false
    });
    if (row.error) { await db.storage.from(BUCKET).remove([path]); failedPhotos++; }
  }

  // The company that suggested it can see it right away (sell price to be set in Products → Companies & sell price).
  await db.from("sourcing_company_products").upsert({ product_id: productId, company_id: proposal.company_id, sell_price: null, currency: "GEL" }, { onConflict: "product_id,company_id" });
  await db.from("sourcing_company_proposals").update({ status: "handled", product_id: productId }).eq("id", proposalId);
  revalidatePath("/company-orders");
  revalidatePath("/products");
  const sku = inserted.data.sku ?? "";
  redirect("/company-orders?ok=" + encodeURIComponent(`Added to Products as ${sku}.${failedPhotos ? ` ${failedPhotos} photo${failedPhotos === 1 ? "" : "s"} could not be copied.` : ""} Set the supplier, price and sell price in Products.`));
}

// ---- Nexo creates and edits company orders ---------------------------------------------------

function orderBack(orderId: string, error?: string): never {
  revalidatePath(`/company-orders/${orderId}`);
  revalidatePath("/company-orders");
  redirect(`/company-orders/${orderId}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

// Success: re-render the current page in place. (Redirecting to the same URL left the list stale until a manual reload.)
function done(orderId: string): void {
  revalidatePath(`/company-orders/${orderId}`);
  revalidatePath("/company-orders");
}

function quantityOf(raw: unknown) {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const number = Number(text);
  return number > 0 && number <= 9999999 ? number : null;
}

function priceOf(raw: unknown): number | null | undefined {
  const text = String(raw ?? "").trim().replace(",", ".");
  if (text === "") return null;
  if (!/^\d+(\.\d+)?$/.test(text) || Number(text) > 9999999) return undefined;
  return Number(text);
}

export async function createCompanyOrderAction(formData: FormData) {
  await requireSourcingAccess();
  const companyId = String(formData.get("company_id") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 2000) || null;
  if (!UUID_PATTERN.test(companyId)) redirect("/company-orders?error=" + encodeURIComponent("Select a company."));
  const db = adminDb();
  const { data: company } = await db.from("sourcing_companies").select("id").eq("id", companyId).maybeSingle();
  if (!company) redirect("/company-orders?error=" + encodeURIComponent("Company not found."));
  const { data, error } = await db.from("sourcing_company_orders").insert({ company_id: companyId, note }).select("id").single();
  if (error || !data) redirect("/company-orders?error=" + encodeURIComponent("Unable to create the order. Run the 20261017 migration first."));
  revalidatePath("/company-orders");
  redirect(`/company-orders/${data.id}`);
}

// Saves the note and every line (quantity, price, currency) of an order. Bound: orderId first.
export async function saveCompanyOrderAction(orderId: string, formData: FormData) {
  await requireSourcingAccess();
  if (!UUID_PATTERN.test(orderId)) redirect("/company-orders");
  const db = adminDb();
  const { data: order } = await db.from("sourcing_company_orders").select("id").eq("id", orderId).maybeSingle();
  if (!order) redirect("/company-orders");
  const { data: items, error } = await db.from("sourcing_company_order_items").select("id,quantity,unit_price,currency").eq("order_id", orderId);
  if (error) orderBack(orderId, "Unable to load the order.");
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  for (const item of items ?? []) {
    const quantity = quantityOf(formData.get(`qty_${item.id}`));
    if (quantity === null) orderBack(orderId, "Enter a valid quantity for every product (more than 0).");
    const price = priceOf(formData.get(`price_${item.id}`));
    if (price === undefined) orderBack(orderId, "Enter a valid price.");
    const currencyRaw = String(formData.get(`cur_${item.id}`) ?? item.currency);
    const currency = CURRENCIES.includes(currencyRaw) ? currencyRaw : item.currency;
    if (quantity !== Number(item.quantity) || price !== (item.unit_price === null ? null : Number(item.unit_price)) || currency !== item.currency) {
      updates.push({ id: item.id, patch: { quantity, unit_price: price, currency } });
    }
  }
  for (const update of updates) {
    const { error: saveError } = await db.from("sourcing_company_order_items").update(update.patch).eq("id", update.id).eq("order_id", orderId);
    if (saveError) orderBack(orderId, "Some changes could not be saved.");
  }
  if (formData.has("note")) {
    await db.from("sourcing_company_orders").update({ note: String(formData.get("note") ?? "").trim().slice(0, 2000) || null }).eq("id", orderId);
  }
  done(orderId);
}

// Adds products (that Nexo marked for this company) with the quantities typed in the "add" list. Bound: orderId first.
export async function addCompanyOrderItemsAction(orderId: string, formData: FormData) {
  await requireSourcingAccess();
  if (!UUID_PATTERN.test(orderId)) redirect("/company-orders");
  const db = adminDb();
  const { data: order } = await db.from("sourcing_company_orders").select("id,company_id").eq("id", orderId).maybeSingle();
  if (!order) redirect("/company-orders");
  const { data: available, error } = await db.from("sourcing_company_products")
    .select("product_id,sell_price,currency,sourcing_products!inner(id,sku,name,status)")
    .eq("company_id", order.company_id).eq("sourcing_products.status", "approved");
  if (error) orderBack(orderId, "Unable to load the products.");
  const { data: existing } = await db.from("sourcing_company_order_items").select("product_id").eq("order_id", orderId);
  const already = new Set<string>((existing ?? []).map((row: any) => row.product_id as string));
  const rows: Record<string, unknown>[] = [];
  for (const row of available ?? []) {
    const raw = String(formData.get(`add_${row.product_id}`) ?? "").trim();
    if (raw === "") continue;
    const quantity = quantityOf(raw);
    if (quantity === null) orderBack(orderId, "Enter a valid quantity (more than 0).");
    if (already.has(row.product_id)) continue;
    rows.push({
      order_id: orderId, product_id: row.product_id, sku: row.sourcing_products.sku ?? null, product_name: row.sourcing_products.name,
      quantity, unit_price: row.sell_price === null ? null : Number(row.sell_price), currency: row.currency
    });
  }
  if (!rows.length) orderBack(orderId, "Type a quantity next to the products you want to add.");
  const { error: insertError } = await db.from("sourcing_company_order_items").insert(rows);
  if (insertError) orderBack(orderId, "Unable to add the products.");
  done(orderId);
}

export async function removeCompanyOrderItemById(orderId: string, itemId: string) {
  await requireSourcingAccess();
  if (!UUID_PATTERN.test(orderId) || !UUID_PATTERN.test(itemId)) redirect("/company-orders");
  const db = adminDb();
  const { error } = await db.from("sourcing_company_order_items").delete().eq("id", itemId).eq("order_id", orderId);
  if (error) orderBack(orderId, "Unable to remove the product.");
  done(orderId);
}

// Nexo marks one line (or every line) of a company order as prepared; the company sees it in its portal.
async function setReady(orderId: string, itemId: string | null, ready: boolean) {
  await requireSourcingAccess();
  if (!UUID_PATTERN.test(orderId) || (itemId !== null && !UUID_PATTERN.test(itemId))) redirect("/company-orders");
  const db = adminDb();
  let query = db.from("sourcing_company_order_items").update({ prepared_at: ready ? new Date().toISOString() : null }).eq("order_id", orderId);
  if (itemId) query = query.eq("id", itemId);
  const { error } = await query;
  if (error) orderBack(orderId, "Unable to update the ready mark. Run supabase/migrations/20261019_company_order_ready.sql first.");
  done(orderId);
}
export async function setCompanyItemReadyById(orderId: string, itemId: string, ready: boolean) { return setReady(orderId, itemId, ready); }
export async function setCompanyAllReadyById(orderId: string, ready: boolean) { return setReady(orderId, null, ready); }

export async function deleteCompanyOrderById(orderId: string) {
  await requireSourcingAccess();
  if (!UUID_PATTERN.test(orderId)) redirect("/company-orders");
  const db = adminDb();
  const { error } = await db.from("sourcing_company_orders").delete().eq("id", orderId);
  if (error) orderBack(orderId, "Unable to delete the order.");
  revalidatePath("/company-orders");
  redirect("/company-orders");
}

// ---- Payments of company orders ----------------------------------------------------------------

// Nexo records a payment: it is confirmed right away. Bound: orderId first.
export async function addCompanyPaymentAction(orderId: string, formData: FormData) {
  const { user } = await requireSourcingAccess();
  if (!UUID_PATTERN.test(orderId)) redirect("/company-orders");
  let payment;
  try {
    payment = parsePayment({
      paidOn: formData.get("paid_on"), amount: formData.get("amount"), currency: formData.get("currency"), method: formData.get("method"), note: formData.get("note")
    });
  } catch (error) { orderBack(orderId, error instanceof Error ? error.message : "Invalid payment."); }
  const db = adminDb();
  const { data: order } = await db.from("sourcing_company_orders").select("id").eq("id", orderId).maybeSingle();
  if (!order) redirect("/company-orders");
  const now = new Date().toISOString();
  const { error } = await db.from("sourcing_company_payments").insert({
    order_id: orderId, paid_on: payment.paidOn, amount: payment.amount, currency: payment.currency, method: payment.method, note: payment.note,
    status: "confirmed", entered_by: "staff", created_by: user.id, confirmed_at: now
  });
  if (error) orderBack(orderId, "Unable to record the payment. Run supabase/migrations/20261018_company_payments.sql first.");
  done(orderId);
}

// Confirms a payment the company recorded; only confirmed payments reduce the balance.
export async function confirmCompanyPaymentById(orderId: string, paymentId: string) {
  await requireSourcingAccess();
  if (!UUID_PATTERN.test(orderId) || !UUID_PATTERN.test(paymentId)) redirect("/company-orders");
  const db = adminDb();
  const { error } = await db.from("sourcing_company_payments").update({ status: "confirmed", confirmed_at: new Date().toISOString() })
    .eq("id", paymentId).eq("order_id", orderId);
  if (error) orderBack(orderId, "Unable to confirm the payment.");
  done(orderId);
}

// Rejects a pending payment or deletes a recorded one.
export async function deleteCompanyPaymentById(orderId: string, paymentId: string) {
  await requireSourcingAccess();
  if (!UUID_PATTERN.test(orderId) || !UUID_PATTERN.test(paymentId)) redirect("/company-orders");
  const db = adminDb();
  const { error } = await db.from("sourcing_company_payments").delete().eq("id", paymentId).eq("order_id", orderId);
  if (error) orderBack(orderId, "Unable to delete the payment.");
  done(orderId);
}
