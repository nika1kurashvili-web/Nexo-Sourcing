"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/supplier-validation";
import { MAX_PRODUCT_IMAGES, productInputFromForm } from "@/lib/catalog-validation";
import { finishProductImageAction, prepareProductImageAction, saveProductAction } from "@/app/product-actions";
import { ProductFieldInputs } from "@/components/ProductFieldInputs";
import { shrinkAll } from "@/lib/image-resize";

// Nexo staff form: create a product for any supplier, or edit an existing one, with photos.
export function ProductEditor({ mode, suppliers = [], product, photoCount = 0, defaultSupplierId = "" }: {
  mode: "create" | "edit";
  suppliers?: { id: string; name: string }[];
  product?: Record<string, any>;
  photoCount?: number;
  defaultSupplierId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const files = Array.from(fileInput.current?.files ?? []);
    setMessage(""); setFailed(false);
    if (photoCount + files.length > MAX_PRODUCT_IMAGES) {
      setFailed(true); setMessage(`A product can have at most ${MAX_PRODUCT_IMAGES} photos.`); return;
    }
    if (files.some(file => !(IMAGE_TYPES as readonly string[]).includes(file.type) || !file.size || file.size > MAX_IMAGE_BYTES)) {
      setFailed(true); setMessage("Photos must be JPEG, PNG, WebP or GIF, up to 10 MB each."); return;
    }
    setBusy(true);
    try {
      const saved: any = await saveProductAction({
        id: product?.id, supplierId: String(data.get("supplier_id") ?? defaultSupplierId),
        fields: productInputFromForm(data, { staff: true })
      });
      if (saved.error || !saved.id) throw new Error(saved.error || "Unable to save the product.");
      let failedUploads = 0;
      for (const file of await shrinkAll(files)) {
        const prepared: any = await prepareProductImageAction(saved.id, file.type, file.size);
        if (prepared.error) { failedUploads++; continue; }
        const { error } = await createClient().storage.from("sourcing-files")
          .uploadToSignedUrl(prepared.path, prepared.uploadToken, file, { contentType: file.type });
        if (error) { failedUploads++; continue; }
        const done: any = await finishProductImageAction(prepared.id);
        if (done.error) failedUploads++;
      }
      if (failedUploads) { setFailed(true); setMessage(`Saved, but ${failedUploads} photo(s) could not be uploaded.`); }
      else setMessage(mode === "create" ? "Product created." : "Product saved.");
      if (mode === "create" && !failedUploads) { form.reset(); }
      router.refresh();
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : "Unable to save the product.");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="form-grid">
      <fieldset disabled={busy} className="form-grid supplier-fieldset">
        {mode === "create" && (
          <label>Supplier *
            <select name="supplier_id" required defaultValue={defaultSupplierId}>
              <option value="" disabled>Select supplier</option>
              {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
        )}
        <ProductFieldInputs values={product} staff />
        <label>Add photos<input ref={fileInput} type="file" name="photos" multiple accept={IMAGE_TYPES.join(",")} /></label>
        <div className="small muted">JPEG, PNG, WebP or GIF · up to 10 MB each · {MAX_PRODUCT_IMAGES} photos per product.</div>
        <div><button className="btn" type="submit">{busy ? "Please wait..." : mode === "create" ? "Create Product" : "Save Product"}</button></div>
      </fieldset>
      {message && <p role={failed ? "alert" : "status"} className={failed ? "notice" : "small"}>{message}</p>}
    </form>
  );
}
