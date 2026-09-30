"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSourcingAccess } from "@/lib/auth";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function numberOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

async function addLog(
  requestId: string | null,
  requestItemId: string | null,
  action: string,
  details?: string | null
) {
  const { supabase, user } = await requireSourcingAccess();
  await supabase.from("sourcing_activity_log").insert({
    request_id: requestId,
    request_item_id: requestItemId,
    user_id: user.id,
    action,
    details: details ?? null
  });
}

export async function loginAction(formData: FormData) {
  const supabase = await createClient();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) redirect("/login?error=invalid");

  const { data: sourcingUser } = await supabase
    .from("sourcing_users")
    .select("user_id, active")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .maybeSingle();

  if (!sourcingUser) {
    await supabase.auth.signOut();
    redirect("/login?error=no-access");
  }

  redirect("/dashboard");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createCompanyAction(formData: FormData) {
  const { supabase } = await requireSourcingAccess();
  const { error } = await supabase.from("sourcing_companies").insert({
    name: clean(formData.get("name")),
    contact_name: clean(formData.get("contact_name")),
    phone: clean(formData.get("phone")),
    email: clean(formData.get("email")),
    notes: clean(formData.get("notes"))
  });
  if (error) redirect("/companies?error=create");
  revalidatePath("/companies");
}

export async function createSupplierAction(formData: FormData) {
  const { supabase } = await requireSourcingAccess();
  const { error } = await supabase.from("sourcing_suppliers").insert({
    name: clean(formData.get("name")),
    contact_name: clean(formData.get("contact_name")),
    phone: clean(formData.get("phone")),
    email: clean(formData.get("email")),
    wechat: clean(formData.get("wechat")),
    notes: clean(formData.get("notes"))
  });
  if (error) redirect("/suppliers?error=create");
  revalidatePath("/suppliers");
}

export async function createRequestAction(formData: FormData) {
  const { supabase, user } = await requireSourcingAccess();
  const { data, error } = await supabase
    .from("sourcing_requests")
    .insert({
      company_id: clean(formData.get("company_id")),
      title: clean(formData.get("title")),
      client_contact: clean(formData.get("client_contact")),
      notes: clean(formData.get("notes")),
      created_by: user.id
    })
    .select("id, request_no")
    .single();

  if (error || !data) redirect("/requests?error=create");
  await addLog(data.id, null, "request_created", data.request_no);
  redirect(`/requests/${data.id}`);
}

export async function updateRequestStatusAction(formData: FormData) {
  const { supabase } = await requireSourcingAccess();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");

  const { error } = await supabase.from("sourcing_requests").update({ status }).eq("id", id);
  if (!error) await addLog(id, null, "request_status_changed", status);

  revalidatePath(`/requests/${id}`);
  revalidatePath("/requests");
  revalidatePath("/dashboard");
}

export async function createRequestItemAction(formData: FormData) {
  const { supabase } = await requireSourcingAccess();
  const requestId = String(formData.get("request_id") ?? "");

  const { data, error } = await supabase
    .from("sourcing_request_items")
    .insert({
      request_id: requestId,
      product_name: clean(formData.get("product_name")),
      quantity: numberOrNull(formData.get("quantity")),
      unit: clean(formData.get("unit")) ?? "pcs",
      specifications: clean(formData.get("specifications")),
      image_url: clean(formData.get("image_url")),
      supplier_id: clean(formData.get("supplier_id")),
      supplier_status: clean(formData.get("supplier_status")) ?? "not_sent",
      china_price: numberOrNull(formData.get("china_price")),
      currency: clean(formData.get("currency")) ?? "USD",
      client_price: numberOrNull(formData.get("client_price")),
      moq: numberOrNull(formData.get("moq")),
      lead_time_days: numberOrNull(formData.get("lead_time_days")),
      supplier_comment: clean(formData.get("supplier_comment")),
      internal_comment: clean(formData.get("internal_comment"))
    })
    .select("id, product_name")
    .single();

  if (!error && data) {
    await supabase.from("sourcing_requests").update({ updated_at: new Date().toISOString() }).eq("id", requestId);
    await addLog(requestId, data.id, "item_created", data.product_name);
  }

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/dashboard");
}

export async function updateRequestItemAction(formData: FormData) {
  const { supabase } = await requireSourcingAccess();
  const id = String(formData.get("id") ?? "");
  const requestId = String(formData.get("request_id") ?? "");

  const { error } = await supabase
    .from("sourcing_request_items")
    .update({
      product_name: clean(formData.get("product_name")),
      quantity: numberOrNull(formData.get("quantity")),
      unit: clean(formData.get("unit")) ?? "pcs",
      specifications: clean(formData.get("specifications")),
      image_url: clean(formData.get("image_url")),
      supplier_id: clean(formData.get("supplier_id")),
      supplier_status: clean(formData.get("supplier_status")) ?? "not_sent",
      china_price: numberOrNull(formData.get("china_price")),
      currency: clean(formData.get("currency")) ?? "USD",
      client_price: numberOrNull(formData.get("client_price")),
      moq: numberOrNull(formData.get("moq")),
      lead_time_days: numberOrNull(formData.get("lead_time_days")),
      supplier_comment: clean(formData.get("supplier_comment")),
      internal_comment: clean(formData.get("internal_comment")),
      client_comment: clean(formData.get("client_comment"))
    })
    .eq("id", id);

  if (!error) {
    await supabase.from("sourcing_requests").update({ updated_at: new Date().toISOString() }).eq("id", requestId);
    await addLog(requestId, id, "item_updated", clean(formData.get("product_name")));
  }

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/dashboard");
}

export async function deleteRequestItemAction(formData: FormData) {
  const { supabase } = await requireSourcingAccess();
  const id = String(formData.get("id") ?? "");
  const requestId = String(formData.get("request_id") ?? "");

  const { error } = await supabase.from("sourcing_request_items").delete().eq("id", id);
  if (!error) await addLog(requestId, null, "item_deleted", id);

  revalidatePath(`/requests/${requestId}`);
  revalidatePath("/dashboard");
}
