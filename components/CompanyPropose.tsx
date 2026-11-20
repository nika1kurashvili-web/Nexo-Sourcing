"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Phone photos are large: shrink them in the browser before uploading.
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}

export function CompanyPropose({ token }: { token: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const source = new FormData(event.currentTarget);
      const body = new FormData();
      for (const key of ["name", "description", "link", "quantity"]) body.set(key, String(source.get(key) ?? ""));
      const photos = source.getAll("photos").filter((value): value is File => typeof value !== "string" && value.size > 0);
      if (photos.length > 3) { setMessage({ text: "You can add at most 3 photos.", ok: false }); setBusy(false); return; }
      for (const photo of photos) body.append("photos", await shrink(photo));
      const response = await fetch(`/api/company/${token}/proposals`, { method: "POST", body, referrerPolicy: "no-referrer" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) setMessage({ text: result.error ?? "Unable to send.", ok: false });
      else { formRef.current?.reset(); setMessage({ text: "Thank you! Nexo will review your suggestion.", ok: true }); router.refresh(); }
    } catch {
      setMessage({ text: "Unable to send. Check your connection and try again.", ok: false });
    }
    setBusy(false);
  }

  return (
    <form ref={formRef} onSubmit={submit} className="card form-grid">
      <h2 style={{ margin: 0 }}>Suggest a new product</h2>
      <p className="small muted" style={{ margin: 0 }}>Tell Nexo about a product you would like to buy. Nexo will review it and get back to you.</p>
      <label>Product name *<input name="name" required maxLength={200} /></label>
      <label>Description<textarea name="description" maxLength={3000} rows={4} placeholder="Size, material, colour, anything that helps" /></label>
      <label>Link to the product (optional)<input name="link" type="url" maxLength={1000} placeholder="https://" /></label>
      <label>How many do you need? (optional)<input name="quantity" inputMode="decimal" maxLength={12} /></label>
      <label>Photos (up to 3)<input name="photos" type="file" accept="image/*" multiple /></label>
      {message && <div className={message.ok ? "notice success" : "notice"} role="status">{message.text}</div>}
      <div><button className="btn" type="submit" disabled={busy}>{busy ? "Sending…" : "Send to Nexo"}</button></div>
    </form>
  );
}
