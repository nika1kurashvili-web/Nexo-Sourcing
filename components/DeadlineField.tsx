import { deadlineInputValue } from "@/lib/request-dates";

export function DeadlineField({ value, disabled = false }: { value?: string | null; disabled?: boolean }) {
  return <label>Deadline
    <input name="deadline_at" type="datetime-local" step="60" defaultValue={deadlineInputValue(value)} disabled={disabled} />
    <span className="small muted">Tbilisi time (Asia/Tbilisi). Optional; leave blank to remove the deadline.</span>
  </label>;
}
