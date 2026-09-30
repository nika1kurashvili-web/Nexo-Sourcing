import Link from "next/link";
import { notFound } from "next/navigation";
import {
  createRequestItemAction,
  deleteRequestItemAction,
  updateRequestItemAction,
  updateRequestDeadlineAction,
  updateRequestStatusAction
} from "@/app/actions";
import { requireSourcingAccess } from "@/lib/auth";
import { activityLabel, requestStatusLabel, requestStatuses, supplierStatuses, supplierStatusLabel } from "@/lib/labels";
import { RequestBadge } from "@/components/RequestBadge";
import { ImageUploadField } from "@/components/ImageUploadField";

import { RequestItemForm } from "@/components/RequestItemForm";
import { SupplierShareLinks } from "@/components/SupplierShareLinks";
import { DeadlineField } from "@/components/DeadlineField";
import { RequestDeadline } from "@/components/RequestDeadline";
import { formatRequestDate } from "@/lib/request-dates";

const STORAGE_BUCKET = "sourcing-files";

export default async function RequestDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase } = await requireSourcingAccess();

  const [
    { data: request },
    { data: itemsData },
    { data: suppliersData },
    { data: activityData }
  ] = await Promise.all([
    supabase
      .from("sourcing_requests")
      .select("*, sourcing_companies(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("sourcing_request_items")
      .select("*, sourcing_suppliers(name)")
      .eq("request_id", id)
      .order("item_no"),
    supabase
      .from("sourcing_suppliers")
      .select("id, name")
      .eq("active", true)
      .order("name"),
    supabase
      .from("sourcing_activity_log")
      .select("id, action, details, created_at")
      .eq("request_id", id)
      .order("created_at", { ascending: false })
      .limit(10)
  ]);

  if (!request) notFound();

  const items = (itemsData ?? []) as any[];
  const suppliers = suppliersData ?? [];
  const activities = activityData ?? [];

  const previewEntries = await Promise.all(
    items.map(async (item) => {
      if (!item.image_url) return [item.id, ""] as const;

      if (/^https?:\/\//i.test(item.image_url)) {
        return [item.id, item.image_url] as const;
      }

      const { data } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(item.image_url, 3600);

      return [item.id, data?.signedUrl ?? ""] as const;
    })
  );

  const previewByItemId = Object.fromEntries(previewEntries) as Record<string, string>;
  const assignedSuppliers = new Map<string, { id: string; name: string; count: number }>();
  for (const item of items) {
    if (!item.supplier_id) continue;
    const supplier = assignedSuppliers.get(item.supplier_id) ?? { id: item.supplier_id, name: item.sourcing_suppliers?.name ?? "Supplier", count: 0 };
    supplier.count++;
    assignedSuppliers.set(item.supplier_id, supplier);
  }
  // RLS still authorizes all admin reads. Missing portal migration must not break
  // the existing request workflow.
  const { data: supplierImages } = await supabase.from("sourcing_supplier_images")
    .select("id,request_item_id,object_path").eq("request_id", id).eq("ready", true);
  const supplierImagePreviews = await Promise.all((supplierImages ?? []).map(async image => {
    const { data } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(image.object_path, 3600);
    return { ...image, url: data?.signedUrl };
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small muted">
            <Link href="/requests">Requests</Link> / {request.request_no}
          </div>
          <h1>{request.request_no}</h1>
          <div className="muted">
            {request.sourcing_companies?.name ?? "No company selected"}
            {request.title ? ` · ${request.title}` : ""}
          </div>
          <div className="request-dates">
            <div>Created: <time dateTime={request.created_at}>{formatRequestDate(request.created_at, true)}</time></div>
            <div>Deadline: <RequestDeadline value={request.deadline_at} status={request.status} /></div>
            <div className="small muted">Tbilisi time (Asia/Tbilisi)</div>
          </div>
        </div>
        <RequestBadge status={request.status} />
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <form action={updateRequestStatusAction} className="form-grid two">
          <input type="hidden" name="id" value={request.id} />
          <label>
            Request Status
            <select name="status" defaultValue={request.status}>
              {requestStatuses.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div style={{ alignSelf: "end" }}>
            <button className="btn" type="submit">
              Save Status
            </button>
          </div>
        </form>

        <hr />
        {!("deadline_at" in request) && <p className="notice">Apply the request deadline SQL migration to enable deadlines.</p>}
        <RequestItemForm action={updateRequestDeadlineAction}>
          <input type="hidden" name="id" value={request.id} />
          <DeadlineField value={request.deadline_at} disabled={!("deadline_at" in request)} />
          <div><button className="btn" type="submit" disabled={!("deadline_at" in request)}>Save Deadline</button></div>
        </RequestItemForm>

        {request.notes && (
          <>
            <hr />
            <div className="small muted">Notes</div>
            <div>{request.notes}</div>
          </>
        )}
      </div>

      <SupplierShareLinks requestId={request.id} suppliers={[...assignedSuppliers.values()]} />

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>+ New Item</h2>
        <hr />

        <RequestItemForm key={items.length} action={createRequestItemAction}>
          <input type="hidden" name="request_id" value={request.id} />

          <div className="form-grid three">
            <label>
              Product Name *
              <input name="product_name" required />
            </label>
            <label>
              Quantity
              <input name="quantity" type="number" step="0.01" />
            </label>
            <label>
              Unit
              <input name="unit" defaultValue="pcs" />
            </label>
          </div>

          <label>
            Specifications / Sourcing Requirements
            <textarea name="specifications" />
          </label>

          <div className="form-grid two">
            <label>
              Supplier
              <select name="supplier_id" defaultValue="">
                <option value="">— No supplier selected —</option>
                {suppliers.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Supplier Status
              <select name="supplier_status" defaultValue="not_sent">
                {supplierStatuses.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-grid three">
            <label>
              China Price
              <input
                name="china_price"
                type="number"
                step="0.01"
              />
            </label>
            <label>
              Currency
              <select
                name="currency" defaultValue="USD"
              >
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
                <option value="EUR">EUR</option>
                <option value="GEL">GEL</option>
              </select>
            </label>
            <label>
              Client Price
              <input
                name="client_price"
                type="number"
                step="0.01"
              />
            </label>
          </div>

          <div className="form-grid two">
            <label>
              MOQ
              <input
                name="moq"
                type="number"
                step="0.01"
              />
            </label>
            <label>
              Lead Time (days)
              <input
                name="lead_time_days"
                type="number"
                min="0"
              />
            </label>
          </div>

          <label>Supplier Comment<textarea name="supplier_comment" /></label>
          <label>Internal Comment<textarea name="internal_comment" /></label>
          <label>Client Comment<textarea name="client_comment" /></label>
          <div>
            <div className="section-label">Packaging Details</div>
            <div className="form-grid four">
              <label>
                Box Length (cm)
                <input name="box_length_cm" type="number" step="0.01" min="0" />
              </label>
              <label>
                Box Width (cm)
                <input name="box_width_cm" type="number" step="0.01" min="0" />
              </label>
              <label>
                Box Height (cm)
                <input name="box_height_cm" type="number" step="0.01" min="0" />
              </label>
              <label>
                Weight (kg)
                <input name="weight_kg" type="number" step="0.001" min="0" />
              </label>
            </div>
          </div>

          <div>
            <div className="section-label">Product Image</div>
            <ImageUploadField requestId={request.id} />
          </div>

          <button className="btn" type="submit">
            Add Item
          </button>
        </RequestItemForm>
      </div>

      <div className="stack">
        {items.length === 0 && (
          <div className="card empty">
            No items in this request yet.
          </div>
        )}

        {items.map((item) => (
          <details className="item-card item-accordion" key={item.id}>
            <summary className="item-summary">
              <span className="item-summary-title">
                <span className="item-number">
                  ITEM-{String(item.item_no).padStart(2, "0")}
                </span>
                <span className="item-title">{item.product_name}</span>
              </span>
              <span className="small muted item-summary-supplier">
                Supplier: {item.sourcing_suppliers?.name ?? "Not assigned"}
              </span>
              <span className="badge">
                {supplierStatusLabel(item.supplier_status)}
              </span>
              {item.china_price != null && (
                <span className="small">China Price: {item.currency ?? "USD"} {Number(item.china_price).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              )}
              {item.quantity != null && (
                <span className="small">Quantity: {item.quantity} {item.unit ?? "pcs"}</span>
              )}
              <svg className="item-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>

            <div className="item-content">

            <RequestItemForm action={updateRequestItemAction}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="request_id" value={request.id} />

              <div className="form-grid three">
                <label>
                  Product Name
                  <input
                    name="product_name"
                    defaultValue={item.product_name}
                    required
                  />
                </label>
                <label>
                  Quantity
                  <input
                    name="quantity"
                    type="number"
                    step="0.01"
                    defaultValue={item.quantity ?? ""}
                  />
                </label>
                <label>
                  Unit
                  <input name="unit" defaultValue={item.unit ?? "pcs"} />
                </label>
              </div>

              <label>
                Specifications
                <textarea
                  name="specifications"
                  defaultValue={item.specifications ?? ""}
                />
              </label>

              <div className="form-grid two">
                <label>
                  Supplier
                  <select
                    name="supplier_id"
                    defaultValue={item.supplier_id ?? ""}
                  >
                    <option value="">— No supplier selected —</option>
                    {suppliers.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Supplier Status
                  <select
                    name="supplier_status"
                    defaultValue={item.supplier_status}
                  >
                    {supplierStatuses.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="form-grid three">
                <label>
                  China Price
                  <input
                    name="china_price"
                    type="number"
                    step="0.01"
                    defaultValue={item.china_price ?? ""}
                  />
                </label>
                <label>
                  Currency
                  <select
                    name="currency"
                    defaultValue={item.currency ?? "USD"}
                  >
                    <option value="USD">USD</option>
                    <option value="CNY">CNY</option>
                    <option value="EUR">EUR</option>
                    <option value="GEL">GEL</option>
                  </select>
                </label>
                <label>
                  Client Price
                  <input
                    name="client_price"
                    type="number"
                    step="0.01"
                    defaultValue={item.client_price ?? ""}
                  />
                </label>
              </div>

              <div className="form-grid two">
                <label>
                  MOQ
                  <input
                    name="moq"
                    type="number"
                    step="0.01"
                    defaultValue={item.moq ?? ""}
                  />
                </label>
                <label>
                  Lead Time (days)
                  <input
                    name="lead_time_days"
                    type="number"
                    min="0"
                    defaultValue={item.lead_time_days ?? ""}
                  />
                </label>
              </div>

              <div>
                <div className="section-label">Packaging Details</div>
                <div className="form-grid four">
                  <label>
                    Box Length (cm)
                    <input
                      name="box_length_cm"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={item.box_length_cm ?? ""}
                    />
                  </label>
                  <label>
                    Box Width (cm)
                    <input
                      name="box_width_cm"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={item.box_width_cm ?? ""}
                    />
                  </label>
                  <label>
                    Box Height (cm)
                    <input
                      name="box_height_cm"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={item.box_height_cm ?? ""}
                    />
                  </label>
                  <label>
                    Weight (kg)
                    <input
                      name="weight_kg"
                      type="number"
                      step="0.001"
                      min="0"
                      defaultValue={item.weight_kg ?? ""}
                    />
                  </label>
                </div>
              </div>

              <label>
                Supplier Comment
                <textarea
                  name="supplier_comment"
                  defaultValue={item.supplier_comment ?? ""}
                />
              </label>

              <label>
                Internal Comment
                <textarea
                  name="internal_comment"
                  defaultValue={item.internal_comment ?? ""}
                />
              </label>

              <label>
                Client Comment
                <textarea
                  name="client_comment"
                  defaultValue={item.client_comment ?? ""}
                />
              </label>

              <div>
                <div className="section-label">Product Image</div>
                <ImageUploadField
                  requestId={request.id}
                  requestItemId={item.id}
                  initialPath={item.image_url ?? ""}
                  initialPreviewUrl={previewByItemId[item.id] ?? ""}
                />
              </div>

              <button className="btn" type="submit">
                Save
              </button>
            </RequestItemForm>

            {supplierImagePreviews.some(image => image.request_item_id === item.id) && <div style={{ marginTop: 14 }}>
              <div className="section-label">Supplier Images</div>
              <div className="upload-controls">{supplierImagePreviews.filter(image => image.request_item_id === item.id).map(image => image.url ?
                <a key={image.id} href={image.url} target="_blank" rel="noopener noreferrer" className="upload-preview-link"><img src={image.url} className="upload-preview" alt="Supplier uploaded image" /></a>
                : <span key={image.id} className="small muted">Image preview unavailable.</span>)}</div>
            </div>}

            <form action={deleteRequestItemAction} style={{ marginTop: 10 }}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="request_id" value={request.id} />
              <button className="btn danger" type="submit">
                Delete Item
              </button>
            </form>
            </div>
          </details>
        ))}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Recent Activity</h2>
        <hr />

        {activities.length === 0 ? (
          <div className="empty">No activity yet.</div>
        ) : (
          <div className="stack">
            {activities.map((a: any) => (
              <div key={a.id}>
                <strong>{activityLabel(a.action)}</strong>
                {a.details ? ` · ${a.action === "request_status_changed" ? requestStatusLabel(a.details) : a.details}` : ""}
                <div className="small muted">
                  {new Date(a.created_at).toLocaleString("en-GB")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
