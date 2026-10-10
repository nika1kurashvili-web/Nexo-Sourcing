"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { ORDER_CURRENCIES, parseAmount, validDate } from "@/lib/orders";

// All actions are staff-only (requireSourcingAccess runs first) and use the server-only
// service client, because the order tables are closed to browser clients.

function back(orderId: string, error?: string): never {
  revalidatePath(`/orders/${orderId}`);
  redirect(`/orders/${orderId}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function loadOrder(db: any, orderId: string) {
  if (!UUID_PATTERN.test(orderId)) redirect("/orders");
  const { data } = await db.from("sourcing_orders").select("id,supplier_id,currency,status").eq("id", orderId).maybeSingle();
  if (!data) redirect("/orders");
  return data as { id: string; supplier_id: string; currency: string; status: string };
}

export async function createOrderAction(formData: FormData) {
  const { user } = await requireSourcingAccess();
  const supplierId = text(formData, "supplier_id");
  const currency = text(formData, "currency") || "USD";
  const note = text(formData, "note").slice(0, 5000) || null;
  if (!UUID_PATTERN.test(supplierId) || !(ORDER_CURRENCIES as readonly string[]).includes(currency)) {
    redirect("/orders?error=Select%20a%20supplier%20and%20currency.");
  }
  const db = adminDb();
  const { data: supplier } = await db.from("sourcing_suppliers").select("id").eq("id", supplierId).maybeSingle();
  if (!supplier) redirect("/orders?error=Supplier%20not%20found.");
  const { data, error } = await db.from("sourcing_orders")
    .insert({ supplier_id: supplierId, currency, note, created_by: user.id }).select("id").single();
  if (error || !data) redirect("/orders?error=Unable%20to%20create%20the%20order.");
  revalidatePath("/orders");
  redirect(`/orders/${data.id}`);
}

// Adds the ticked catalog products (approved products of this order's supplier only).
export async function addOrderItemsAction(formData: FormData) {
  await requireSourcingAccess();
  const orderId = text(formData, "order_id");
  const db = adminDb();
  const order = await loadOrder(db, orderId);
  if (!["draft", "sent"].includes(order.status)) back(orderId, "This order is locked. Reopen it to change products.");

  const picked = formData.getAll("product").map(String).filter(id => UUID_PATTERN.test(id)).slice(0, 300);
  if (!picked.length) back(orderId, "Tick at least one product.");
  const { data: products } = await db.from("sourcing_products")
    .select("id,sku,name,price,currency").eq("supplier_id", order.supplier_id).eq("status", "approved").in("id", picked);
  const { data: existing } = await db.from("sourcing_order_items").select("product_id").eq("order_id", orderId);
  const already = new Set((existing ?? []).map((row: any) => row.product_id));

  const rows: any[] = [];
  try {
    for (const product of products ?? []) {
      if (already.has(product.id)) continue;
      const quantity = parseAmount(formData.get(`qty_${product.id}`) || "1", "quantity", { min: 0.01 });
      rows.push({
        order_id: orderId, product_id: product.id, sku: product.sku, product_name: product.name, quantity,
        // The catalog price is a sensible starting point, but only in the order's currency.
        unit_price: product.price !== null && product.currency === order.currency ? product.price : null
      });
    }
  } catch (error) {
    back(orderId, error instanceof Error ? error.message : "Invalid quantity.");
  }
  if (!rows.length) back(orderId, "Those products are already in the order.");
  const { error } = await db.from("sourcing_order_items").insert(rows);
  if (error) back(orderId, "Unable to add the products.");
  await db.from("sourcing_orders").update({ updated_at: new Date().toISOString() }).eq("id", orderId);
  back(orderId);
}

// Saves quantity and price for every line in one go.
export async function saveOrderItemsAction(formData: FormData) {
  await requireSourcingAccess();
  const orderId = text(formData, "order_id");
  const db = adminDb();
  const order = await loadOrder(db, orderId);
  if (!["draft", "sent"].includes(order.status)) back(orderId, "This order is locked. Reopen it to change it.");
  const { data: items } = await db.from("sourcing_order_items").select("id,quantity,unit_price,proposed_price").eq("order_id", orderId);

  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  try {
    for (const item of items ?? []) {
      if (!formData.has(`qty_${item.id}`)) continue;
      const quantity = parseAmount(formData.get(`qty_${item.id}`), "quantity", { min: 0.01 });
      const price = parseAmount(formData.get(`price_${item.id}`), "price", { allowEmpty: true });
      const patch: Record<string, unknown> = {};
      if (Number(item.quantity) !== quantity) patch.quantity = quantity;
      if ((item.unit_price === null ? null : Number(item.unit_price)) !== price) {
        patch.unit_price = price;
        // Nexo typed the price itself, so an older supplier suggestion is obsolete.
        patch.proposed_price = null;
      }
      if (Object.keys(patch).length) updates.push({ id: item.id, patch: { ...patch, updated_at: new Date().toISOString() } });
    }
  } catch (error) {
    back(orderId, error instanceof Error ? error.message : "Invalid value.");
  }
  for (const update of updates) {
    const { error } = await db.from("sourcing_order_items").update(update.patch).eq("id", update.id).eq("order_id", orderId);
    if (error) back(orderId, "Some changes could not be saved.");
  }
  if (updates.length) await db.from("sourcing_orders").update({ updated_at: new Date().toISOString() }).eq("id", orderId);
  back(orderId);
}

async function decideProposals(formData: FormData, decision: "approve" | "reject") {
  await requireSourcingAccess();
  const orderId = text(formData, "order_id");
  const db = adminDb();
  const order = await loadOrder(db, orderId);
  if (!["draft", "sent"].includes(order.status)) back(orderId, "This order is locked. Reopen it to change it.");
  const itemId = text(formData, "item");
  let query = db.from("sourcing_order_items").select("id,proposed_price").eq("order_id", orderId).not("proposed_price", "is", null);
  if (itemId) {
    if (!UUID_PATTERN.test(itemId)) back(orderId);
    query = query.eq("id", itemId);
  }
  const { data: items } = await query;
  for (const item of items ?? []) {
    const patch = decision === "approve"
      ? { unit_price: item.proposed_price, proposed_price: null }
      : { proposed_price: null };
    await db.from("sourcing_order_items").update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", item.id).eq("order_id", orderId);
  }
  back(orderId);
}
export async function approveProposalAction(formData: FormData) { return decideProposals(formData, "approve"); }
export async function rejectProposalAction(formData: FormData) { return decideProposals(formData, "reject"); }

export async function removeOrderItemAction(formData: FormData) {
  await requireSourcingAccess();
  const orderId = text(formData, "order_id");
  const itemId = text(formData, "item");
  const db = adminDb();
  const order = await loadOrder(db, orderId);
  if (!["draft", "sent"].includes(order.status)) back(orderId, "This order is locked. Reopen it to change it.");
  if (UUID_PATTERN.test(itemId)) await db.from("sourcing_order_items").delete().eq("id", itemId).eq("order_id", orderId);
  back(orderId);
}

// draft -> sent -> confirmed, plus cancel / reopen. Confirming needs every line priced and no open suggestions.
export async function setOrderStatusAction(formData: FormData) {
  await requireSourcingAccess();
  const orderId = text(formData, "order_id");
  const target = text(formData, "to");
  const db = adminDb();
  const order = await loadOrder(db, orderId);
  const allowed: Record<string, string[]> = {
    draft: ["sent", "confirmed", "cancelled"],
    sent: ["draft", "confirmed", "cancelled"],
    confirmed: ["sent", "cancelled"],
    cancelled: ["draft"]
  };
  if (!allowed[order.status]?.includes(target)) back(orderId, "That change is not possible.");

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: target, updated_at: now };
  if (target === "sent") patch.sent_at = now;
  if (target === "confirmed") {
    const { data: items } = await db.from("sourcing_order_items").select("unit_price,proposed_price").eq("order_id", orderId);
    if (!items?.length) back(orderId, "Add at least one product first.");
    if (items.some((item: any) => item.unit_price === null)) back(orderId, "Every product needs an approved price before you confirm.");
    if (items.some((item: any) => item.proposed_price !== null)) back(orderId, "Approve or reject the supplier's price suggestions first.");
    patch.confirmed_at = now;
  } else {
    patch.confirmed_at = null;
  }
  const { error } = await db.from("sourcing_orders").update(patch).eq("id", orderId).eq("status", order.status);
  if (error) back(orderId, "Unable to change the status.");
  revalidatePath("/orders");
  back(orderId);
}

export async function updateOrderNoteAction(formData: FormData) {
  await requireSourcingAccess();
  const orderId = text(formData, "order_id");
  const db = adminDb();
  await loadOrder(db, orderId);
  await db.from("sourcing_orders").update({ note: text(formData, "note").slice(0, 5000) || null, updated_at: new Date().toISOString() }).eq("id", orderId);
  back(orderId);
}

export async function deleteOrderAction(formData: FormData) {
  await requireSourcingAccess();
  const orderId = text(formData, "order_id");
  const db = adminDb();
  const order = await loadOrder(db, orderId);
  if (!["draft", "cancelled"].includes(order.status)) back(orderId, "Only a draft or cancelled order can be deleted.");
  const { count } = await db.from("sourcing_order_payments").select("id", { count: "exact", head: true }).eq("order_id", orderId);
  if (count) back(orderId, "This order has recorded payments. Delete them first.");
  const { error } = await db.from("sourcing_orders").delete().eq("id", orderId);
  if (error) back(orderId, "Unable to delete the order.");
  revalidatePath("/orders");
  redirect("/orders");
}

export async function addPaymentAction(formData: FormData) {
  const { user } = await requireSourcingAccess();
  const orderId = text(formData, "order_id");
  const db = adminDb();
  await loadOrder(db, orderId);
  let amount: number | null;
  try { amount = parseAmount(formData.get("amount"), "amount", { min: 0.01, max: 999999999 }); }
  catch (error) { back(orderId, error instanceof Error ? error.message : "Invalid amount."); }
  const paidOn = text(formData, "paid_on");
  if (!validDate(paidOn)) back(orderId, "Enter a valid payment date.");
  const { error } = await db.from("sourcing_order_payments").insert({
    order_id: orderId, paid_on: paidOn, amount, note: text(formData, "note").slice(0, 1000) || null, created_by: user.id
  });
  if (error) back(orderId, "Unable to record the payment.");
  back(orderId);
}

export async function deletePaymentAction(formData: FormData) {
  await requireSourcingAccess();
  const orderId = text(formData, "order_id");
  const paymentId = text(formData, "payment");
  const db = adminDb();
  await loadOrder(db, orderId);
  if (UUID_PATTERN.test(paymentId)) await db.from("sourcing_order_payments").delete().eq("id", paymentId).eq("order_id", orderId);
  back(orderId);
}
