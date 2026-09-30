import { INVALID_LINK, readSupplierPortal } from "@/lib/supplier-portal";
import { supplierStatusLabel } from "@/lib/labels";
import { RESPONSE_FIELDS } from "@/lib/supplier-validation";
import { SupplierResponseForm } from "@/components/SupplierResponseForm";
import { SupplierSession } from "@/components/SupplierSession";
import { SupplierRequestDates } from "@/components/SupplierRequestDates";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SupplierPortal({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let portal;
  try { portal = await readSupplierPortal(token); }
  catch { return <p className="card">{INVALID_LINK}</p>; }
  return <SupplierSession token={token}>
    {portal.items.length === 0 ? <p className="card">No items are currently assigned to you for this request.</p> : <>
      <div className="page-head"><div>
        <h2>Request: {portal.requestNo}</h2>
<p>Supplier: {portal.supplierName}</p>

<SupplierRequestDates
  createdAt={portal.createdAt}
  deadlineAt={portal.deadlineAt}
/>

<p className="muted">{portal.items.length} assigned items</p>
      </div></div>
      <div className="stack">{portal.items.map(item => {
        const referenceImages = [
  ...(item.image_url
    ? [
        {
          id: "reference",
          url: /^https?:\/\//i.test(
            item.image_url
          )
            ? item.image_url
            : `/api/supplier/${token}/items/${item.id}/images/reference`,
        },
      ]
    : []),

  ...portal.referenceImages
    .filter(
      (image) =>
        image.request_item_id === item.id
    )
    .map((image) => ({
      id: image.id as string,
      url: `/api/supplier/${token}/items/${item.id}/images/ref-${image.id}`,
    })),
];
        const response = Object.fromEntries(RESPONSE_FIELDS.map(key => [key, item[key]]));
        const images = portal.images.filter(image => image.request_item_id === item.id).map(image => ({
          id: image.id as string, url: `/api/supplier/${token}/items/${item.id}/images/${image.id}`
        }));
        return <details className="item-card item-accordion" key={item.id}>
          <summary className="item-summary">
            <span className="item-summary-title"><span className="item-number">ITEM-{String(item.item_no).padStart(2, "0")}</span><span className="item-title">{item.product_name}</span></span>
            {item.quantity != null && <span className="small">Quantity: {item.quantity} {item.unit ?? "pcs"}</span>}
            <span className="badge">{supplierStatusLabel(item.supplier_status)}</span>
            <svg className="item-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </summary>
          <div className="item-content form-grid">
            <div><strong>Specifications</strong><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.specifications || "No specifications provided."}</p></div>
            {referenceImages.length > 0 && (
  <div>
    <div className="section-label">
      Nexo Reference Images (read-only)
    </div>

    <div
      className="upload-controls"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
      }}
    >
      {referenceImages.map(
        (image, index) => (
          <a
            key={image.id}
            href={image.url}
            target="_blank"
            rel="noopener noreferrer"
            className="upload-preview-link"
          >
            <img
              src={image.url}
              referrerPolicy="no-referrer"
              className="upload-preview"
              alt={`Nexo reference image ${
                index + 1
              }`}
            />
          </a>
        )
      )}
    </div>

    <div className="small muted">
      {referenceImages.length} reference{" "}
      {referenceImages.length === 1
        ? "image"
        : "images"}
    </div>
  </div>
)}
            <SupplierResponseForm token={token} itemId={item.id} response={response} images={images} />
          </div>
        </details>;
      })}</div>
    </>}
  </SupplierSession>;
}
