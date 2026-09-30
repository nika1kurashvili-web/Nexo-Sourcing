import Link from "next/link";
import { notFound } from "next/navigation";
import {
  createRequestItemAction,
  deleteRequestItemAction,
  updateRequestItemAction,
  updateRequestStatusAction
} from "@/app/actions";
import { requireSourcingAccess } from "@/lib/auth";
import { requestStatuses, supplierStatuses, supplierStatusLabel } from "@/lib/labels";
import { RequestBadge } from "@/components/RequestBadge";

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireSourcingAccess();

  const [{ data: request }, { data: itemsData }, { data: suppliersData }, { data: activityData }] =
    await Promise.all([
      supabase.from("sourcing_requests").select("*, sourcing_companies(name)").eq("id", id).maybeSingle(),
      supabase.from("sourcing_request_items").select("*, sourcing_suppliers(name)").eq("request_id", id).order("item_no"),
      supabase.from("sourcing_suppliers").select("id, name").eq("active", true).order("name"),
      supabase.from("sourcing_activity_log").select("id, action, details, created_at")
        .eq("request_id", id).order("created_at", { ascending: false }).limit(10)
    ]);

  if (!request) notFound();

  const items = (itemsData ?? []) as any[];
  const suppliers = suppliersData ?? [];
  const activities = activityData ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="small muted"><Link href="/requests">Requests</Link> / {request.request_no}</div>
          <h1>{request.request_no}</h1>
          <div className="muted">
            {request.sourcing_companies?.name ?? "კომპანია არ არის მითითებული"}
            {request.title ? ` · ${request.title}` : ""}
          </div>
        </div>
        <RequestBadge status={request.status} />
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <form action={updateRequestStatusAction} className="form-grid two">
          <input type="hidden" name="id" value={request.id} />
          <label>მოთხოვნის საერთო სტატუსი
            <select name="status" defaultValue={request.status}>
              {requestStatuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div style={{ alignSelf: "end" }}><button className="btn" type="submit">სტატუსის შენახვა</button></div>
        </form>
        {request.notes && <><hr /><div className="small muted">შენიშვნა</div><div>{request.notes}</div></>}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h2>+ ახალი ნივთი</h2><hr />
        <form action={createRequestItemAction} className="form-grid">
          <input type="hidden" name="request_id" value={request.id} />
          <div className="form-grid three">
            <label>პროდუქტი *<input name="product_name" required /></label>
            <label>რაოდენობა<input name="quantity" type="number" step="0.01" /></label>
            <label>ერთეული<input name="unit" defaultValue="pcs" /></label>
          </div>
          <label>სპეციფიკაცია / რა უნდა მოძებნოს ჩინელმა<textarea name="specifications" /></label>
          <div className="form-grid two">
            <label>Supplier
              <select name="supplier_id" defaultValue="">
                <option value="">— ჯერ არ არის მიბმული —</option>
                {suppliers.map((s:any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Supplier Status
              <select name="supplier_status" defaultValue="not_sent">
                {supplierStatuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <label>ფოტოს / ფაილის ლინკი<input name="image_url" placeholder="https://..." /></label>
          <button className="btn" type="submit">ნივთის დამატება</button>
        </form>
      </div>

      <div className="stack">
        {items.length === 0 && <div className="card empty">ამ მოთხოვნაში ჯერ ნივთი არ არის დამატებული.</div>}
        {items.map((item) => (
          <div className="item-card" key={item.id}>
            <div className="item-head">
              <div><span className="item-number">ITEM-{String(item.item_no).padStart(2, "0")}</span><span className="item-title">{item.product_name}</span></div>
              <span className="badge">{supplierStatusLabel(item.supplier_status)}</span>
            </div>

            <form action={updateRequestItemAction} className="form-grid">
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="request_id" value={request.id} />

              <div className="form-grid three">
                <label>პროდუქტი<input name="product_name" defaultValue={item.product_name} required /></label>
                <label>რაოდენობა<input name="quantity" type="number" step="0.01" defaultValue={item.quantity ?? ""} /></label>
                <label>ერთეული<input name="unit" defaultValue={item.unit ?? "pcs"} /></label>
              </div>

              <label>სპეციფიკაცია<textarea name="specifications" defaultValue={item.specifications ?? ""} /></label>

              <div className="form-grid two">
                <label>Supplier
                  <select name="supplier_id" defaultValue={item.supplier_id ?? ""}>
                    <option value="">— არ არის მიბმული —</option>
                    {suppliers.map((s:any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label>Supplier Status
                  <select name="supplier_status" defaultValue={item.supplier_status}>
                    {supplierStatuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
              </div>

              <div className="form-grid three">
                <label>China Price<input name="china_price" type="number" step="0.01" defaultValue={item.china_price ?? ""} /></label>
                <label>Currency
                  <select name="currency" defaultValue={item.currency ?? "USD"}>
                    <option value="USD">USD</option><option value="CNY">CNY</option><option value="EUR">EUR</option><option value="GEL">GEL</option>
                  </select>
                </label>
                <label>Client Price<input name="client_price" type="number" step="0.01" defaultValue={item.client_price ?? ""} /></label>
              </div>

              <div className="form-grid two">
                <label>MOQ<input name="moq" type="number" step="0.01" defaultValue={item.moq ?? ""} /></label>
                <label>წარმოების ვადა (დღე)<input name="lead_time_days" type="number" defaultValue={item.lead_time_days ?? ""} /></label>
              </div>

              <label>Supplier comment<textarea name="supplier_comment" defaultValue={item.supplier_comment ?? ""} /></label>
              <label>Internal comment<textarea name="internal_comment" defaultValue={item.internal_comment ?? ""} /></label>
              <label>Client comment<textarea name="client_comment" defaultValue={item.client_comment ?? ""} /></label>
              <label>ფოტოს / ფაილის ლინკი<input name="image_url" defaultValue={item.image_url ?? ""} /></label>

              {item.image_url && <div className="small"><a className="row-link" href={item.image_url} target="_blank" rel="noreferrer">გახსენი მიმაგრებული ლინკი ↗</a></div>}
              <button className="btn" type="submit">შენახვა</button>
            </form>

            <form action={deleteRequestItemAction} style={{ marginTop: 10 }}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="request_id" value={request.id} />
              <button className="btn danger" type="submit">ნივთის წაშლა</button>
            </form>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>ბოლო ცვლილებები</h2><hr />
        {activities.length === 0 ? <div className="empty">ისტორია ჯერ ცარიელია.</div> : (
          <div className="stack">
            {activities.map((a:any) => <div key={a.id}>
              <strong>{a.action}</strong>{a.details ? ` · ${a.details}` : ""}
              <div className="small muted">{new Date(a.created_at).toLocaleString("ka-GE")}</div>
            </div>)}
          </div>
        )}
      </div>
    </>
  );
}
