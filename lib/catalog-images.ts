import "server-only";
import { BUCKET } from "@/lib/supplier-portal";
import { MAX_IMAGE_BYTES, imageMime } from "@/lib/supplier-validation";

// Removes Storage objects after the database already forgot them. Best effort:
// an orphaned private file is harmless, a failed page is not.
export async function removeStoragePaths(db: any, paths: unknown) {
  const list = Array.isArray(paths) ? paths.filter((path): path is string => typeof path === "string" && path.length > 0) : [];
  if (!list.length) return;
  try { await db.storage.from(BUCKET).remove(list); } catch { /* ignore */ }
}

// Checks the real bytes of an uploaded file, not just the browser-provided MIME type.
// A bad file is deleted from Storage. Returns true only for a valid, size-matching image.
export async function verifyUploadedImage(db: any, image: { object_path: string; mime_type: string; byte_size: number }) {
  const { data: file, error } = await db.storage.from(BUCKET).download(image.object_path);
  if (error || !file) return { ok: false as const, error: "Image upload is incomplete. Please try again." };
  const mime = imageMime(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (file.size !== image.byte_size || file.size > MAX_IMAGE_BYTES || mime !== image.mime_type) {
    await db.storage.from(BUCKET).remove([image.object_path]);
    return { ok: false as const, error: "The uploaded file is not a supported image or exceeds the size limit." };
  }
  return { ok: true as const };
}

export async function signedUploadToken(db: any, path: string) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (error || !data) return null;
  return data.token as string;
}
