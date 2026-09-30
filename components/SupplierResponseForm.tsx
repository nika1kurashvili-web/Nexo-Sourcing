"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, RESPONSE_FIELDS, RESPONSE_STATUSES } from "@/lib/supplier-validation";
import { supplierStatusLabel } from "@/lib/labels";

const fields = [
  ["china_price", "China Price", "0.01"], ["moq", "MOQ", "0.01"], ["lead_time_days", "Lead Time (days)", "1"],
  ["box_length_cm", "Box Length (cm)", "0.01"], ["box_width_cm", "Box Width (cm)", "0.01"],
  ["box_height_cm", "Box Height (cm)", "0.01"], ["weight_kg", "Weight (kg)", "0.001"]
] as const;

export function SupplierResponseForm({ token, itemId, response, images }: {
  token: string; itemId: string; response: Record<string, string | number | null>;
  images: { id: string; url: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const endpoint = `/api/supplier/${token}/items/${itemId}`;

  async function submit(payload: unknown) {
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), cache: "no-store", referrerPolicy: "no-referrer" });
    const data = await res.json();
    if (!res.ok) { if (res.status === 404) router.refresh(); throw new Error(data.error || "Unable to save. Please try again."); }
    return data;
  }
  async function upload(file: File) {
    setMessage(""); setFailed(false);
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type) || !file.size || file.size > MAX_IMAGE_BYTES) {
      setFailed(true); setMessage("Choose a JPEG, PNG, WebP, or GIF image up to 10 MB."); return;
    }
    setBusy(true);
    try {
      const prepared = await submit({ operation: "prepare_image", mime: file.type, size: file.size });
      const { error } = await createClient().storage.from("sourcing-files").uploadToSignedUrl(prepared.path, prepared.uploadToken, file, { contentType: file.type });
      if (error) throw new Error("Image upload failed. Please try again.");
      await submit({ operation: "finish_image", imageId: prepared.id });
      setMessage("Image uploaded."); router.refresh();
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Image upload failed."); }
    finally { setBusy(false); }
  }

  return <div className="form-grid">
    <form onSubmit={async event => {
      event.preventDefault(); if (busy) return;
      const form = new FormData(event.currentTarget);
      const values = Object.fromEntries(RESPONSE_FIELDS.map(key => [key, form.get(key)]));
      setBusy(true); setFailed(false); setMessage("");
      try { await submit({ operation: "response", response: values }); setMessage("Response saved."); router.refresh(); }
      catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Unable to save."); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy} className="form-grid supplier-fieldset">
        <h3>Supplier Response</h3>
        <div className="form-grid three">
          {fields.map(([name, label, step]) => <label key={name}>{label}<input name={name} type="number" min="0" max="9999999" step={step} defaultValue={response[name] ?? ""} /></label>)}
          <label>Currency<select name="currency" defaultValue={response.currency ?? "USD"}>{["USD","CNY","EUR","GEL"].map(currency => <option key={currency}>{currency}</option>)}</select></label>
          <label>Supplier Status<select name="supplier_status" defaultValue={RESPONSE_STATUSES.includes(response.supplier_status as typeof RESPONSE_STATUSES[number]) ? String(response.supplier_status) : "waiting"}>
            {RESPONSE_STATUSES.map(status => <option key={status} value={status}>{supplierStatusLabel(status)}</option>)}
          </select></label>
        </div>
        <label>Supplier Comment<textarea name="supplier_comment" maxLength={10000} defaultValue={response.supplier_comment ?? ""} /></label>
        <button className="btn" type="submit">{busy ? "Please wait..." : "Save Response"}</button>
      </fieldset>
    </form>
    <div className="upload-box">
      <strong>Supplier Images</strong>
      <div className="upload-controls">{images.map(image => <a key={image.id} href={image.url} target="_blank" rel="noopener noreferrer" className="upload-preview-link"><img className="upload-preview" src={image.url} referrerPolicy="no-referrer" alt="Supplier uploaded image" /></a>)}</div>
      <label>Upload Image<input type="file" accept={IMAGE_TYPES.join(",")} disabled={busy} onChange={event => {
        const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void upload(file);
      }} /></label>
      <div className="small muted">JPEG, PNG, WebP or GIF · Maximum 10 MB · Up to 20 images per item. Uploaded images are saved immediately.</div>
    </div>
    {message && <p role={failed ? "alert" : "status"} className={failed ? "notice" : "small"}>{message}</p>}
  </div>;
}
