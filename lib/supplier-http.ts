import "server-only";
import { INVALID_LINK } from "@/lib/supplier-portal";

export const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Content-Security-Policy": "frame-ancestors 'none'"
};
export function supplierJson(value: unknown, status = 200) {
  return Response.json(value, { status, headers: PRIVATE_HEADERS });
}
export function supplierDenied() { return supplierJson({ error: INVALID_LINK }, 404); }

export async function supplierBody(request: Request) {
  // Browser mutations must come from this site, not a form on a third-party site.
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) {
    throw new Error("Invalid request.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Invalid request.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 20000) { await reader.cancel(); throw new Error("Response is too large."); }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request.");
  return value as Record<string, unknown>;
}
