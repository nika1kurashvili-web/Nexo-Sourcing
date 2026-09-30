import { createSupplierAction } from "@/app/actions";
import { requireSourcingAccess } from "@/lib/auth";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const { supabase } = await requireSourcingAccess();
  const { data } = await supabase.from("sourcing_suppliers").select("*").order("name");
  const suppliers = data ?? [];

  return (
    <>
      <div className="page-head"><div><h1>Suppliers</h1><div className="muted">ჩინელი აგენტები / მომწოდებლები</div></div></div>
      {params.error && <div className="notice">Supplier-ის დამატება ვერ მოხერხდა.</div>}
      <div className="two-col">
        <div className="card">
          <h2>ახალი Supplier</h2><hr />
          <form action={createSupplierAction} className="form-grid">
            <label>სახელი / კომპანია *<input name="name" required /></label>
            <label>საკონტაქტო პირი<input name="contact_name" /></label>
            <label>WeChat<input name="wechat" /></label>
            <label>ტელეფონი<input name="phone" /></label>
            <label>Email<input name="email" type="email" /></label>
            <label>შენიშვნა<textarea name="notes" /></label>
            <button className="btn" type="submit">დამატება</button>
          </form>
        </div>
        <div className="card">
          <h2>Suppliers ({suppliers.length})</h2><hr />
          {suppliers.length === 0 ? <div className="empty">ჯერ Supplier არ არის დამატებული.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>სახელი</th><th>Contact</th><th>WeChat</th><th>ტელეფონი</th></tr></thead>
              <tbody>{suppliers.map((s:any) => <tr key={s.id}>
                <td><strong>{s.name}</strong></td><td>{s.contact_name ?? "—"}</td><td>{s.wechat ?? "—"}</td><td>{s.phone ?? "—"}</td>
              </tr>)}</tbody>
            </table></div>
          )}
        </div>
      </div>
    </>
  );
}
