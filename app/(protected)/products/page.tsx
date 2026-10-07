import Link from "next/link";
import { requireSourcingAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET } from "@/lib/supplier-portal";
import { UUID_PATTERN } from "@/lib/catalog-validation";
import { decryptShareToken, catalogLinkUrl } from "@/lib/share-link-crypto";
import { decideSubmissionAction, deleteProductAction, deleteProductImageAction } from "@/app/product-actions";
import { ProductEditor } from "@/components/ProductEditor";
import { CatalogLinkControls } from "@/components/CatalogLinkControls";
import { ConfirmButton } from "@/components/ConfirmButton";

export const dynamic = "force-dynamic";

const COMPARE_FIELDS: [string, string][] = [
  ["name", "Name"], ["description", "Description"], ["specifications", "Specifications"], ["price", "Price"],
  ["currency", "Currency"], ["moq", "MOQ"], ["lead_time_days", "Lead time (days)"],
  ["box_length_cm", "Box length (cm)"], ["box_width_cm", "Box width (cm)"], ["box_height_cm", "Box height (cm)"],
  ["weight_kg", "Weight (kg)"]
];

function number(value: unknown) {
  return Number(value).toLocaleString("en-GB", { maximumFractionDigits: 4 });
}

function same(a: unknown, b: unknown) {
  const empty = (value: unknown) => value === null || value === undefined || value === "";
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a).trim() === String(b).trim();
}

function show(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "number" ? number(value) : String(value);
}

function Specs({ product }: { product: any }) {
  const box = [product.box_length_cm, product.box_width_cm, product.box_height_cm];
  return (
    <dl className="spec-list">
      <dt>Price</dt><dd>{product.price != null ? `${product.currency} ${number(product.price)}` : "—"}</dd>
      <dt>MOQ</dt><dd>{product.moq != null ? number(product.moq) : "—"}</dd>
      <dt>Lead time</dt><dd>{product.lead_time_days != null ? `${product.lead_time_days} days` : "—"}</dd>
      <dt>Box (L×W×H)</dt><dd>{box.some(value => value != null) ? `${box.map(value => (value != null ? number(value) : "?")).join(" × ")} cm` : "—"}</dd>
      <dt>Weight</dt><dd>{product.weight_kg != null ? `${number(product.weight_kg)} kg` : "—"}</dd>
    </dl>
  );
}

function Photos({ images, urls, removable }: { images: any[]; urls: Record<string, string>; removable: boolean }) {
  const first = images.find(image => urls[image.id]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {first ? <a href={urls[first.id]} target="_blank" rel="noopener noreferrer"><img className="product-photo" src={urls[first.id]} alt="Product photo" loading="lazy" /></a>
        : <div className="product-photo-empty">No photo</div>}
      {images.length > 0 && (
        <div className="product-thumbs">
          {images.filter(image => urls[image.id]).map(image => (
            <div className="product-thumb" key={image.id}>
              <a href={urls[image.id]} target="_blank" rel="noopener noreferrer" title={image.approved ? "Photo" : "Photo waiting for approval"}>
                <img src={urls[image.id]} alt="Product thumbnail" loading="lazy" style={image.approved ? undefined : { outline: "2px solid #efd9a7" }} />
              </a>
              {removable && (
                <form action={deleteProductImageAction}>
                  <input type="hidden" name="imageId" value={image.id} />
                  <ConfirmButton message="Remove this photo?" className="thumb-remove">×</ConfirmButton>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionForms({ kind, id, approveLabel, rejectLabel }: { kind: "product" | "change"; id: string; approveLabel: string; rejectLabel: string }) {
  return (
    <div className="product-actions">
      <form action={decideSubmissionAction}>
        <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="decision" value="approve" />
        <button className="btn" type="submit">{approveLabel}</button>
      </form>
      <form action={decideSubmissionAction}>
        <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="decision" value="reject" />
        <ConfirmButton message="Are you sure? This cannot be undone." className="btn danger">{rejectLabel}</ConfirmButton>
      </form>
    </div>
  );
}

export default async function ProductsPage({ searchParams }: {
  searchParams: Promise<{ supplier?: string; status?: string; q?: string }>;
}) {
  const params = await searchParams;
  await requireSourcingAccess();

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return (
      <>
        <div className="page-head"><div><h1>Products</h1></div></div>
        <div className="notice">The product catalog needs SUPABASE_SERVICE_ROLE_KEY on the server. Add it in Vercel and redeploy.</div>
      </>
    );
  }

  const db: any = createAdminClient();
  const supplierFilter = params.supplier && UUID_PATTERN.test(params.supplier) ? params.supplier : "";
  const statusFilter = params.status === "approved" || params.status === "pending" ? params.status : "";
  const search = (params.q ?? "").replace(/[%_,()*\\]/g, " ").trim().slice(0, 80);

  let productQuery = db.from("sourcing_products").select("*, sourcing_suppliers(name)").order("created_at", { ascending: false }).limit(150);
  if (supplierFilter) productQuery = productQuery.eq("supplier_id", supplierFilter);
  if (search) productQuery = productQuery.ilike("name", `%${search}%`);

  const [suppliersResult, productsResult, changesResult, linksResult] = await Promise.all([
    db.from("sourcing_suppliers").select("id,name").order("name"),
    productQuery,
    db.from("sourcing_product_changes").select("id,product_id,kind,payload,created_at").eq("status", "pending").order("created_at"),
    db.from("sourcing_catalog_links").select("id,supplier_id,token_encrypted").eq("active", true)
  ]);

  const setupMissing = !!(productsResult.error || changesResult.error || linksResult.error);
  if (setupMissing) {
    return (
      <>
        <div className="page-head"><div><h1>Products</h1></div></div>
        <div className="notice">The product catalog is not set up yet. Run supabase/migrations/20261007_product_catalog.sql in the Supabase SQL Editor, then reload this page.</div>
      </>
    );
  }

  const suppliers: any[] = suppliersResult.data ?? [];
  const allProducts: any[] = productsResult.data ?? [];
  const productById = new Map<string, any>(allProducts.map(product => [product.id, product]));
  const changes: any[] = (changesResult.data ?? []).filter((change: any) => productById.has(change.product_id));
  const changeByProduct = new Map<string, any>(changes.map(change => [change.product_id, change]));

  const ids = allProducts.map(product => product.id as string);
  const imageResult = ids.length
    ? await db.from("sourcing_product_images").select("id,product_id,object_path,approved").eq("ready", true).in("product_id", ids).order("created_at")
    : { data: [] };
  const images: any[] = imageResult.data ?? [];

  const urls: Record<string, string> = {};
  if (images.length) {
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrls(images.map(image => image.object_path), 3600);
    images.forEach((image, index) => { if (signed?.[index]?.signedUrl) urls[image.id] = signed[index].signedUrl; });
  }
  const imagesOf = (productId: string) => images.filter(image => image.product_id === productId);

  const linkBySupplier = new Map<string, { id: string; url: string | null }>();
  for (const link of linksResult.data ?? []) {
    const token = decryptShareToken(link.token_encrypted);
    linkBySupplier.set(link.supplier_id, { id: link.id, url: token ? catalogLinkUrl(token) : null });
  }

  const pendingProducts = allProducts.filter(product => product.status === "pending");
  const visible = allProducts.filter(product => !statusFilter || product.status === statusFilter);
  const waiting = pendingProducts.length + changes.length;

  return (
    <>
      <div className="page-head">
        <div><h1>Products</h1><div className="muted">Supplier catalog: what each supplier offers, with photos and full details</div></div>
      </div>

      <form method="get" className="card filter-bar">
        <label>Supplier
          <select name="supplier" defaultValue={supplierFilter}>
            <option value="">All suppliers</option>
            {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
        </label>
        <label>Status
          <select name="status" defaultValue={statusFilter}>
            <option value="">All</option><option value="approved">Approved</option><option value="pending">Waiting for approval</option>
          </select>
        </label>
        <label>Search by name<input name="q" defaultValue={params.q ?? ""} placeholder="Product name" /></label>
        <div className="filter-actions"><button className="btn" type="submit">Filter</button><Link className="btn secondary" href="/products">Reset</Link></div>
      </form>

      {waiting > 0 && (
        <section style={{ marginBottom: 20 }}>
          <h2 style={{ marginBottom: 12 }}>Waiting for your confirmation ({waiting})</h2>
          {pendingProducts.map(product => (
            <div className="approval-card" key={product.id}>
              <div className="badges"><span className="badge warning">New product from supplier</span><span className="badge">{product.sourcing_suppliers?.name ?? "Supplier"}</span></div>
              <div className="product-title">{product.name}</div>
              <Photos images={imagesOf(product.id)} urls={urls} removable={false} />
              <Specs product={product} />
              {product.description && <p className="product-text">{product.description}</p>}
              {product.specifications && <p className="product-text">{product.specifications}</p>}
              <DecisionForms kind="product" id={product.id} approveLabel="Approve product" rejectLabel="Reject & delete" />
            </div>
          ))}
          {changes.map(change => {
            const product = productById.get(change.product_id);
            const pendingPhotos = imagesOf(product.id).filter(image => !image.approved);
            return (
              <div className="approval-card" key={change.id}>
                <div className="badges">
                  <span className="badge warning">{change.kind === "delete" ? "Deletion requested" : "Edit requested"}</span>
                  <span className="badge">{product.sourcing_suppliers?.name ?? "Supplier"}</span>
                </div>
                <div className="product-title">{product.name}</div>
                {change.kind === "delete" ? (
                  <p className="small muted" style={{ margin: 0 }}>The supplier asked to remove this product. It stays in the catalog unless you approve.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="diff-table">
                      <thead><tr><th>Field</th><th>Current</th><th>Requested</th></tr></thead>
                      <tbody>
                        {COMPARE_FIELDS.filter(([key]) => !same(product[key], change.payload?.[key])).map(([key, label]) => (
                          <tr key={key}><td>{label}</td><td className="diff-old">{show(product[key])}</td><td className="diff-new">{show(change.payload?.[key])}</td></tr>
                        ))}
                        {COMPARE_FIELDS.every(([key]) => same(product[key], change.payload?.[key])) && (
                          <tr><td colSpan={3} className="muted">No field values changed{pendingPhotos.length ? "; new photos only" : ""}.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                {pendingPhotos.length > 0 && <>
                  <div className="small muted">New photos from the supplier ({pendingPhotos.length}):</div>
                  <Photos images={pendingPhotos} urls={urls} removable={false} />
                </>}
                <DecisionForms kind="change" id={change.id}
                  approveLabel={change.kind === "delete" ? "Approve deletion" : "Approve changes"}
                  rejectLabel={change.kind === "delete" ? "Keep product" : "Reject changes"} />
              </div>
            );
          })}
        </section>
      )}

      <details className="card" style={{ marginBottom: 14 }}>
        <summary>+ New Product</summary>
        <ProductEditor mode="create" suppliers={suppliers} defaultSupplierId={supplierFilter} />
      </details>

      <details className="card" style={{ marginBottom: 18 }}>
        <summary>Supplier catalog links ({linkBySupplier.size} active)</summary>
        <p className="small muted">Give a supplier its link so it can add products and request changes. Suppliers only ever see their own products.</p>
        <div className="stack">
          {suppliers.map(supplier => <CatalogLinkControls key={supplier.id} supplier={supplier} link={linkBySupplier.get(supplier.id) ?? null} />)}
          {suppliers.length === 0 && <div className="muted">Add a supplier first.</div>}
        </div>
      </details>

      <div className="small muted" style={{ marginBottom: 10 }}>{visible.length} product{visible.length === 1 ? "" : "s"}{allProducts.length >= 150 ? " (showing the newest 150; use filters to narrow down)" : ""}</div>
      {visible.length === 0 ? <div className="card empty">No products found.</div> : (
        <div className="product-grid">
          {visible.map(product => {
            const change = changeByProduct.get(product.id);
            const productImages = imagesOf(product.id);
            return (
              <div className="product-card" key={product.id}>
                <Photos images={productImages} urls={urls} removable />
                <div className="badges">
                  <span className="badge">{product.sourcing_suppliers?.name ?? "Supplier"}</span>
                  {product.status === "pending" ? <span className="badge warning">Waiting for approval</span> : <span className="badge success">Approved</span>}
                  {change && <span className="badge warning">{change.kind === "delete" ? "Deletion requested" : "Edit requested"}</span>}
                </div>
                <div className="product-title">{product.name}</div>
                <Specs product={product} />
                {product.description && <p className="product-text">{product.description}</p>}
                {product.specifications && <p className="product-text muted">{product.specifications}</p>}
                {product.internal_note && <p className="product-text"><strong>Internal:</strong> {product.internal_note}</p>}
                <div className="product-actions">
                  <details style={{ width: "100%" }}>
                    <summary className="btn secondary" style={{ display: "inline-flex" }}>Edit</summary>
                    <div style={{ marginTop: 12 }}><ProductEditor mode="edit" product={product} photoCount={productImages.length} /></div>
                  </details>
                  <form action={deleteProductAction}>
                    <input type="hidden" name="id" value={product.id} />
                    <ConfirmButton message="Delete this product and its photos permanently?" className="btn danger">Delete</ConfirmButton>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
