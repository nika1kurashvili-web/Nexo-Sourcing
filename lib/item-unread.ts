// PostgreSQL keeps microseconds; Date.parse alone can conflate two versions.
export function timestampMicros(value: string | null | undefined): bigint | null {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!match) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  return BigInt(milliseconds) * BigInt(1000) + BigInt((match[1] ?? "").padEnd(6, "0").slice(3));
}

export function hasUnreadUpdate(changedAt: string | null | undefined, seenAt: string | null | undefined) {
  const changed = timestampMicros(changedAt);
  const seen = timestampMicros(seenAt);
  return changed !== null && (seen === null || changed > seen);
}

export function parseSeenThrough(body: Record<string, unknown>) {
  if (Object.keys(body).length !== 1 || typeof body.seenThrough !== "string" || timestampMicros(body.seenThrough) === null) {
    throw new Error("Invalid seen timestamp.");
  }
  return body.seenThrough;
}
