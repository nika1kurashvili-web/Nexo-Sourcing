import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Supplier share tokens are stored encrypted (AES-256-GCM) so staff can see the
// same link again later. The lookup hash (token_hash) is unchanged. The key comes
// from SHARE_LINK_ENCRYPTION_KEY when set, otherwise from the server-only
// SUPABASE_SERVICE_ROLE_KEY, so a database leak alone does not reveal any link.
const PREFIX = "v1:";

function encryptionKey() {
  const secret = process.env.SHARE_LINK_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return Buffer.from(hkdfSync("sha256", secret, "nexo-sourcing", "supplier-share-link-v1", 32));
}

export function encryptShareToken(token: string): string | null {
  const key = encryptionKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

// Returns null when the value is missing, was made with another key, or is damaged.
export function decryptShareToken(value: string | null | undefined): string | null {
  try {
    const key = encryptionKey();
    if (!key || !value || !value.startsWith(PREFIX)) return null;
    const raw = Buffer.from(value.slice(PREFIX.length), "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const token = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    return /^[0-9a-f]{64}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function supplierLinkUrl(token: string) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://sourcing.nexo.ge").replace(/\/+$/, "");
  return `${siteUrl}/supplier/${token}`;
}
