"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSourcingAccess } from "@/lib/auth";
import { adminDb } from "@/lib/admin-db";
import { COST_FIELDS } from "@/lib/landed-cost";

// Staff-only: saves the numbers behind the cost line on the Products page.
export async function saveCostSettingsAction(formData: FormData) {
  await requireSourcingAccess();
  const rows: { key: string; value: number; updated_at: string }[] = [];
  for (const field of COST_FIELDS) {
    const text = String(formData.get(field.key) ?? "").trim().replace(",", ".");
    const value = /^\d+(\.\d+)?$/.test(text) ? Number(text) : NaN;
    if (!Number.isFinite(value) || value <= 0 || value >= 1_000_000) {
      redirect(`/products?cost_error=${encodeURIComponent(`Enter a valid number for: ${field.label}`)}`);
    }
    rows.push({ key: field.key, value, updated_at: new Date().toISOString() });
  }
  const { error } = await adminDb().from("sourcing_settings").upsert(rows, { onConflict: "key" });
  if (error) redirect(`/products?cost_error=${encodeURIComponent("Unable to save. Run the latest SQL migration (20261013_cost_settings.sql) first.")}`);
  revalidatePath("/products");
  redirect("/products");
}
