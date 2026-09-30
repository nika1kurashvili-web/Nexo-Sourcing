export const REQUEST_TIME_ZONE = "Asia/Tbilisi";
export const CLOSED_REQUEST_STATUSES = ["approved", "rejected", "cancelled"] as const;

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatRequestDate(value: string | null | undefined, includeTime = false) {
  const date = validDate(value);
  if (!date) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: REQUEST_TIME_ZONE, month: "short", day: "numeric", year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } as const : {})
  }).format(date);
}

export function deadlineInputValue(value: string | null | undefined) {
  const date = validDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: REQUEST_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function parseDeadlineInput(value: FormDataEntryValue | null): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Enter a valid deadline date and time.");
  const wallTime = new Date(`${value}:00Z`).getTime();
  if (!Number.isFinite(wallTime)) throw new Error("Enter a valid deadline date and time.");
  // Convert the business-zone wall clock to an instant, independent of the
  // browser/server timezone. A round-trip rejects invalid calendar dates.
  let instant = wallTime;
  for (let attempt = 0; attempt < 2; attempt++) {
    const displayed = deadlineInputValue(new Date(instant).toISOString());
    instant += wallTime - new Date(`${displayed}:00Z`).getTime();
  }
  const result = new Date(instant).toISOString();
  if (deadlineInputValue(result) !== value) throw new Error("Enter a valid deadline date and time.");
  return result;
}

export function deadlineState(value: string | null | undefined, status: string, now = new Date()): "overdue" | "today" | null {
  const date = validDate(value);
  if (!date || (CLOSED_REQUEST_STATUSES as readonly string[]).includes(status)) return null;
  if (date.getTime() < now.getTime()) return "overdue";
  if (deadlineInputValue(date.toISOString()).slice(0, 10) === deadlineInputValue(now.toISOString()).slice(0, 10)) return "today";
  return null;
}
