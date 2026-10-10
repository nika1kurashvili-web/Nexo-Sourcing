"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IMAGE_TYPES } from "@/lib/supplier-validation";
import { shrinkImage } from "@/lib/image-resize";
import { finishBulkImagesAction, prepareBulkImagesAction } from "@/app/product-actions";

const BATCH = 12;

// Many photos at once, matched to products by file name (P00012.jpg, P00012_2.jpg ...).
// Photos are shrunk in the browser first, so uploads are fast and the site stays light.
export function BulkPhotoUpload({ suppliers, defaultSupplierId = "" }: { suppliers: { id: string; name: string }[]; defaultSupplierId?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [supplierId, setSupplierId] = useState(defaultSupplierId);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [summary, setSummary] = useState<{ uploaded: number; problems: string[] } | null>(null);

  async function run() {
    const chosen = Array.from(input.current?.files ?? []);
    if (!supplierId) { setProgress("Select a supplier first."); return; }
    if (!chosen.length) { setProgress("Choose the photos first."); return; }
    setBusy(true); setSummary(null);
    let uploaded = 0;
    const problems: string[] = [];
    try {
      for (let start = 0; start < chosen.length; start += BATCH) {
        const originals = chosen.slice(start, start + BATCH);
        setProgress(`Preparing ${Math.min(start + BATCH, chosen.length)} of ${chosen.length}...`);
        // Shrink; keep the original file name for matching.
        const files: (File | null)[] = [];
        for (const file of originals) {
          if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) { problems.push(`${file.name}: not a JPEG, PNG, WebP or GIF image`); files.push(null); continue; }
          try { const shrunk = await shrinkImage(file); files.push(new File([shrunk], file.name, { type: shrunk.type })); }
          catch { problems.push(`${file.name}: the image could not be read`); files.push(null); }
        }
        const usable = files.map((file, index) => ({ file, index })).filter((entry): entry is { file: File; index: number } => !!entry.file);
        if (!usable.length) continue;
        const prepared = await prepareBulkImagesAction(supplierId, usable.map(({ file }) => ({ name: file.name, mime: file.type, size: file.size })));
        if (prepared.error || !prepared.results) { usable.forEach(({ file }) => problems.push(`${file.name}: ${prepared.error ?? "failed"}`)); continue; }

        setProgress(`Uploading ${Math.min(start + BATCH, chosen.length)} of ${chosen.length}...`);
        const toFinish: string[] = [];
        const names = new Map<string, string>();
        const storage = createClient().storage.from("sourcing-files");
        let cursor = 0;
        async function worker() {
          while (cursor < usable.length) {
            const at = cursor++;
            const target = prepared.results![at];
            const { file } = usable[at];
            if ("error" in target) { problems.push(`${file.name}: ${target.error}`); continue; }
            const { error } = await storage.uploadToSignedUrl(target.path, target.uploadToken, file, { contentType: file.type });
            if (error) { problems.push(`${file.name}: upload failed`); continue; }
            toFinish.push(target.id); names.set(target.id, file.name);
          }
        }
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (toFinish.length) {
          const done = await finishBulkImagesAction(toFinish);
          for (const result of done.results ?? []) {
            if (result.ok) uploaded++;
            else problems.push(`${names.get(result.id) ?? "photo"}: ${result.error ?? "failed"}`);
          }
          if (done.error) toFinish.forEach(id => problems.push(`${names.get(id)}: ${done.error}`));
        }
      }
      setProgress("");
      setSummary({ uploaded, problems });
      if (input.current) input.current.value = "";
      router.refresh();
    } catch (error) {
      setProgress(error instanceof Error ? error.message : "The upload stopped unexpectedly.");
      setSummary({ uploaded, problems });
    } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        Name each photo after the product code (shown on every product card): <strong>P00012.jpg</strong>, and <strong>P00012_2.jpg</strong>, <strong>P00012_3.jpg</strong> for more photos of the same product.
        Photos are reduced in your browser before upload. Up to 10 photos per product.
      </p>
      <div className="form-grid two">
        <label>Supplier *
          <select value={supplierId} onChange={event => setSupplierId(event.target.value)} disabled={busy}>
            <option value="">Select supplier</option>
            {suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
        </label>
        <label>Photos<input ref={input} type="file" multiple accept={IMAGE_TYPES.join(",")} disabled={busy} /></label>
      </div>
      <div><button className="btn" type="button" onClick={run} disabled={busy}>{busy ? "Uploading..." : "Upload photos"}</button></div>
      {progress && <p className="small" role="status">{progress}</p>}
      {summary && (
        <div className={summary.problems.length ? "notice" : "small"} role="status">
          <strong>{summary.uploaded} photo{summary.uploaded === 1 ? "" : "s"} uploaded.</strong>
          {summary.problems.length > 0 && <>
            <div>{summary.problems.length} could not be uploaded:</div>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {summary.problems.slice(0, 30).map((problem, index) => <li key={index}>{problem}</li>)}
            </ul>
            {summary.problems.length > 30 && <div>...and {summary.problems.length - 30} more.</div>}
          </>}
        </div>
      )}
    </div>
  );
}
