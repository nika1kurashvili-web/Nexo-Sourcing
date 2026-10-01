"use client";

import { useActionState } from "react";
import { updateCompanyAction } from "@/app/actions";

type Company = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

export function CompanyEditForm({ company }: { company: Company }) {
  const [result, action, pending] = useActionState(
    async (_previous: Awaited<ReturnType<typeof updateCompanyAction>> | null, data: FormData) => updateCompanyAction(data),
    null
  );
  return (
    <details>
      <summary style={{ cursor: "pointer" }}>Edit</summary>
      <form action={action}>
        <input type="hidden" name="id" value={company.id} />
        <fieldset disabled={pending} className="form-grid" style={{ border: 0, padding: 0, margin: "12px 0", minWidth: 220 }}>
          <label>Company Name *<input name="name" required defaultValue={company.name} /></label>
          <label>Contact Person<input name="contact_name" defaultValue={company.contact_name ?? ""} /></label>
          <label>Phone<input name="phone" defaultValue={company.phone ?? ""} /></label>
          <label>Email<input name="email" type="email" defaultValue={company.email ?? ""} /></label>
          <label>Notes<textarea name="notes" defaultValue={company.notes ?? ""} /></label>
          <button className="btn" type="submit">{pending ? "Saving..." : "Save"}</button>
        </fieldset>
        {result && "error" in result && <p className="notice" role="alert">{result.error}</p>}
        {result && "success" in result && <p role="status">Company saved.</p>}
      </form>
    </details>
  );
}
