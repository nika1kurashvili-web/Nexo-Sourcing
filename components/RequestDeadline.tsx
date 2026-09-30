import { deadlineState, formatRequestDate } from "@/lib/request-dates";

export function RequestDeadline({ value, status, now }: { value?: string | null; status: string; now?: Date }) {
  const state = deadlineState(value, status, now);
  return <span className="request-deadline">
    {value ? <time dateTime={value}>{formatRequestDate(value, true)}</time> : <span className="muted">Not set</span>}
    {state && <span className={`badge ${state === "overdue" ? "danger" : "warning"}`}>{state === "overdue" ? "Overdue" : "Due today"}</span>}
  </span>;
}
