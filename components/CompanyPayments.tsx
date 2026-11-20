"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PAYMENT_CURRENCIES, PAYMENT_METHODS, paymentMethodLabel } from "@/lib/company-orders";

export type PaymentRow = { id: string; paid_on: string; amount: number | string; currency: string; method: string; note: string | null; status: string; entered_by: string };

const fmt = (value: number) => value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The company's view of the payments of one order: what is recorded, and a form to record a new payment.
export function CompanyPayments({ token, orderId, payments, currencies, cancelled, today }: {
  token: string; orderId: string; payments: PaymentRow[]; currencies: string[]; cancelled: boolean; today: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const options = currencies.length ? currencies : PAYMENT_CURRENCIES;

  async function call(payload: Record<string, unknown>) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/company/${token}/payments`, {
        method: "POST", headers: { "Content-Type": "application/json" }, referrerPolicy: "no-referrer", body: JSON.stringify({ orderId, ...payload })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage({ text: result.error ?? "Unable to save.", ok: false }); setBusy(false); return false; }
      router.refresh();
      setBusy(false);
      return true;
    } catch {
      setMessage({ text: "Unable to save. Check your connection and try again.", ok: false });
      setBusy(false);
      return false;
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await call({
      operation: "add", paidOn: data.get("paid_on"), amount: data.get("amount"), currency: data.get("currency"), method: data.get("method"), note: data.get("note")
    });
    if (ok) { form.reset(); setMessage({ text: "Payment recorded. It counts after Nexo confirms it.", ok: true }); }
  }

  return (
    <div className="stack" style={{ marginTop: 12 }}>
      <h3 style={{ margin: 0 }}>Payments</h3>
      {payments.length === 0 ? <div className="muted small">No payments recorded yet.</div> : (
        <div className="table-wrap order-table"><table>
          <thead><tr><th>Date</th><th>Amount</th><th>How</th><th>Note</th><th>Status</th><th></th></tr></thead>
          <tbody>{payments.map(payment => (
            <tr key={payment.id}>
              <td>{payment.paid_on}</td>
              <td className="num">{payment.currency} {fmt(Number(payment.amount))}</td>
              <td>{paymentMethodLabel(payment.method)}</td>
              <td>{payment.note ?? "—"}</td>
              <td><span className={`badge ${payment.status === "confirmed" ? "success" : "warning"}`}>{payment.status === "confirmed" ? "Confirmed" : "Waiting for Nexo"}</span></td>
              <td>{payment.status === "pending" && payment.entered_by === "company" &&
                <button className="btn secondary sm" type="button" disabled={busy} onClick={() => { if (confirm("Withdraw this payment?")) void call({ operation: "withdraw", paymentId: payment.id }); }}>Withdraw</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {!cancelled && (
        <form onSubmit={submit} className="form-grid four">
          <label>Date<input type="date" name="paid_on" defaultValue={today} required /></label>
          <label>Amount<input name="amount" inputMode="decimal" required placeholder="0.00" /></label>
          <label>Currency<select name="currency" defaultValue={options[0]}>{options.map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></label>
          <label>Paid by<select name="method" defaultValue="transfer">{PAYMENT_METHODS.map(method => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
          <label style={{ gridColumn: "1 / -1" }}>Note (optional)<input name="note" maxLength={1000} placeholder="e.g. transfer reference" /></label>
          <div><button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Record payment"}</button></div>
        </form>
      )}
      {message && <div className={message.ok ? "notice success" : "notice"} role="status">{message.text}</div>}
    </div>
  );
}
