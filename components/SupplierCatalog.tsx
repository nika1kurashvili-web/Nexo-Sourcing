"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/supplier-validation";
import { MAX_PRODUCT_IMAGES, productInputFromForm } from "@/lib/catalog-validation";
import { ProductFieldInputs } from "@/components/ProductFieldInputs";

type Product = {
  id: string; name: string; description: string | null; specifications: string | null;
  price: number | null; currency: string; moq: number | null; lead_time_days: number | null;
  box_length_cm: number | null; box_width_cm: number | null; box_height_cm: number | null; weight_kg: number | null; qty_in_box: number | null;
  status: "pending" | "approved";
  images: { id: string; approved: boolean }[];
  change: { kind: "edit" | "delete"; payload: Record<string, any> | null; created_at: string } | null;
};

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

function number(value: number) {
  return value.toLocaleString("en-GB", { maximumFractionDigits: 4 });
}

async function api(token: string, payload: Record<string, unknown>) {
  const response = await fetch(`/api/supplier-catalog/${token}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    cache: "no-store", referrerPolicy: "no-referrer"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || "Unable to save. Please try again.", response.status);
  return data;
}

async function uploadPhotos(token: string, productId: string, files: File[]) {
  let failedUploads = 0;
  for (const file of files) {
    try {
      const prepared = await api(token, { operation: "prepare_image", productId, mime: file.type, size: file.size });
      const { error } = await createClient().storage.from("sourcing-files")
        .uploadToSignedUrl(prepared.path, prepared.uploadToken, file, { contentType: file.type });
      if (error) throw new Error("upload failed");
      await api(token, { operation: "finish_image", imageId: prepared.id });
    } catch { failedUploads++; }
  }
  return failedUploads;
}

function checkFiles(files: File[], existing: number) {
  if (existing + files.length > MAX_PRODUCT_IMAGES) return `A product can have at most ${MAX_PRODUCT_IMAGES} photos.`;
  if (files.some(file => !(IMAGE_TYPES as readonly string[]).includes(file.type) || !file.size || file.size > MAX_IMAGE_BYTES)) {
    return "Photos must be JPEG, PNG, WebP or GIF, up to 10 MB each.";
  }
  return "";
}

function SupplierForm({ token, mode, product, initial }: {
  token: string; mode: "create" | "edit"; product?: Product; initial?: Record<string, any>;
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
    const fields = productInputFromForm(new FormData(form));
    const files = Array.from(fileInput.current?.files ?? []);
    setMessage(""); setFailed(false);
    const problem = checkFiles(files, product?.images.length ?? 0);
    if (problem) { setFailed(true); setMessage(problem); return; }
    setBusy(true);
    try {
      let productId = product?.id ?? "";
      if (mode === "create") {
        const created = await api(token, { operation: "create_product", product: fields });
        productId = created.id;
      } else {
        await api(token, { operation: "request_edit", productId, product: fields });
      }
      const failedUploads = files.length ? await uploadPhotos(token, productId, files) : 0;
      if (failedUploads) { setFailed(true); setMessage(`Sent, but ${failedUploads} photo(s) could not be uploaded.`); }
      else setMessage(mode === "create" ? "Product submitted. It shows as approved once Nexo confirms it." : "Edit request sent. Nothing changes until Nexo confirms it.");
      if (mode === "create" && !failedUploads) form.reset();
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) router.refresh();
      setFailed(true); setMessage(error instanceof Error ? error.message : "Unable to save. Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="form-grid">
      <fieldset disabled={busy} className="form-grid supplier-fieldset">
        <ProductFieldInputs values={initial} />
        <label>{mode === "create" ? "Photos" : "Add photos"}<input ref={fileInput} type="file" multiple accept={IMAGE_TYPES.join(",")} /></label>
        <div className="small muted">JPEG, PNG, WebP or GIF · up to 10 MB each · {MAX_PRODUCT_IMAGES} photos per product.</div>
        <div><button className="btn" type="submit">{busy ? "Please wait..." : mode === "create" ? "Submit Product" : product?.change ? "Update Request" : "Send Edit Request"}</button></div>
      </fieldset>
      {message && <p role={failed ? "alert" : "status"} className={failed ? "notice" : "small"}>{message}</p>}
    </form>
  );
}

function ProductCard({ token, product }: { token: string; product: Product }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const base = `/api/supplier-catalog/${token}/images`;
  const photo = product.images[0];
  const box = [product.box_length_cm, product.box_width_cm, product.box_height_cm];
  const pending = product.change;

  async function act(operation: "request_delete" | "cancel_change", question: string, done: string) {
    if (question && !confirm(question)) return;
    setBusy(true); setMessage("");
    try { await api(token, { operation, productId: product.id }); setMessage(done); router.refresh(); }
    catch (error) {
      if (error instanceof ApiError && error.status === 404) router.refresh();
      setMessage(error instanceof Error ? error.message : "Unable to send the request.");
    } finally { setBusy(false); }
  }

  return (
    <div className="product-card">
      <div className="stack" style={{ gap: 8 }}>
        {photo ? <a href={`${base}/${photo.id}`} target="_blank" rel="noopener noreferrer"><img className="product-photo" src={`${base}/${photo.id}`} referrerPolicy="no-referrer" alt="Product photo" loading="lazy" /></a>
          : <div className="product-photo-empty">No photo</div>}
        {product.images.length > 1 && (
          <div className="product-thumbs">
            {product.images.map(image => (
              <a key={image.id} className="product-thumb" href={`${base}/${image.id}`} target="_blank" rel="noopener noreferrer">
                <img src={`${base}/${image.id}`} referrerPolicy="no-referrer" alt="Product thumbnail" loading="lazy" style={image.approved ? undefined : { outline: "2px solid #efd9a7" }} />
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="badges">
        {product.status === "pending" ? <span className="badge warning">Waiting for Nexo approval</span> : <span className="badge success">Approved</span>}
        {pending && <span className="badge warning">{pending.kind === "delete" ? "Deletion requested" : "Edit requested"}</span>}
      </div>
      <div className="product-title">{product.name}</div>
      <dl className="spec-list">
        <dt>Price</dt><dd>{product.price != null ? `${product.currency} ${number(product.price)}` : "—"}</dd>
        <dt>MOQ</dt><dd>{product.moq != null ? number(product.moq) : "—"}</dd>
        <dt>Lead time</dt><dd>{product.lead_time_days != null ? `${product.lead_time_days} days` : "—"}</dd>
        <dt>Box (L×W×H)</dt><dd>{box.some(value => value != null) ? `${box.map(value => (value != null ? number(value) : "?")).join(" × ")} cm` : "—"}</dd>
        <dt>Weight</dt><dd>{product.weight_kg != null ? `${number(product.weight_kg)} kg` : "—"}</dd>
        <dt>Qty in box</dt><dd>{product.qty_in_box != null ? number(product.qty_in_box) : "—"}</dd>
      </dl>
      {product.description && <p className="product-text">{product.description}</p>}
      {product.specifications && <p className="product-text muted">{product.specifications}</p>}
      {pending && <div className="notice" style={{ margin: 0 }}>Your {pending.kind === "delete" ? "deletion" : "edit"} request is waiting for Nexo&apos;s confirmation. The values above stay unchanged until then.</div>}
      <div className="product-actions">
        <details style={{ width: "100%" }}>
          <summary className="btn secondary" style={{ display: "inline-flex" }}>{pending?.kind === "edit" ? "Change my request" : "Request edit"}</summary>
          <div style={{ marginTop: 12 }}>
            <SupplierForm token={token} mode="edit" product={product}
              initial={pending?.kind === "edit" && pending.payload ? pending.payload : product} />
          </div>
        </details>
        {pending && <button className="btn secondary" disabled={busy} onClick={() => void act("cancel_change", "", "Request cancelled.")}>Cancel request</button>}
        {pending?.kind !== "delete" && (
          <button className="btn danger" disabled={busy}
            onClick={() => void act("request_delete", "Ask Nexo to delete this product? It stays in the catalog until Nexo confirms.", "Deletion request sent.")}>
            Request deletion
          </button>
        )}
      </div>
      {message && <p role="status" className="small" style={{ margin: 0 }}>{message}</p>}
    </div>
  );
}

// Suppliers never edit or delete live products here: they send requests that Nexo confirms.
export function SupplierCatalog({ token, supplierName, products }: { token: string; supplierName: string; products: Product[] }) {
  return (
    <>
      <div className="page-head">
        <div><h2>Product Catalog</h2><p>Supplier: {supplierName}</p>
          <p className="muted">{products.length} product{products.length === 1 ? "" : "s"}</p></div>
      </div>
      <div className="notice">New products are reviewed by Nexo. You cannot change or delete a product directly: send an edit or deletion request and Nexo will confirm it.</div>
      <details className="card" style={{ marginBottom: 16 }}>
        <summary>+ Add New Product</summary>
        <SupplierForm token={token} mode="create" />
      </details>
      {products.length === 0 ? <div className="card empty">No products yet. Add your first product above.</div> : (
        <div className="product-grid">{products.map(product => <ProductCard key={product.id} token={token} product={product} />)}</div>
      )}
    </>
  );
}
