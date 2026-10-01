"use client";

import { useActionState } from "react";
import { updateSupplierAction } from "@/app/actions";

type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  wechat: string | null;
  notes: string | null;
};

export function SupplierEditForm({ supplier }: { supplier: Supplier }) {
  const [result, action, pending] = useActionState(
    async (_previous: Awaited<ReturnType<typeof updateSupplierAction>> | null, data: FormData) => updateSupplierAction(data),
    null
  );
  return (
    <details>
      <summary style={{ cursor: "pointer" }}>Edit</summary>
      <form action={action}>
        <input type="hidden" name="id" value={supplier.id} />
        <fieldset disabled={pending} className="form-grid" style={{ border: 0, padding: 0, margin: "12px 0", minWidth: 220 }}>
          <label>Name / Company *<input name="name" required defaultValue={supplier.name} /></label>
          <label>Contact Person<input name="contact_name" defaultValue={supplier.contact_name ?? ""} /></label>
          <label>WeChat<input name="wechat" defaultValue={supplier.wechat ?? ""} /></label>
          <label>Phone<input name="phone" defaultValue={supplier.phone ?? ""} /></label>
          <label>Email<input name="email" type="email" defaultValue={supplier.email ?? ""} /></label>
          <label>Notes<textarea name="notes" defaultValue={supplier.notes ?? ""} /></label>
          <button className="btn" type="submit">{pending ? "Saving..." : "Save"}</button>
        </fieldset>
        {result && "error" in result && <p className="notice" role="alert">{result.error}</p>}
        {result && "success" in result && <p role="status">Supplier saved.</p>}
      </form>
    </details>
  );
}
