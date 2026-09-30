"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useItemUpload } from "@/components/RequestItemForm";

const BUCKET = "sourcing-files";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function safeExtension(fileName: string) {
  const raw = fileName.split(".").pop()?.toLowerCase() || "jpg";
  return raw.replace(/[^a-z0-9]/g, "") || "jpg";
}

export function ImageUploadField({
  requestId,
  requestItemId,
  name = "image_url",
  initialPath = "",
  initialPreviewUrl = ""
}: {
  requestId: string;
  requestItemId?: string;
  name?: string;
  initialPath?: string | null;
  initialPreviewUrl?: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [path, setPath] = useState(initialPath ?? "");
  const [previewUrl, setPreviewUrl] = useState(initialPreviewUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const { setUploading: setFormUploading } = useItemUpload();

  useEffect(() => {
    setPath(initialPath ?? "");
    setPreviewUrl(initialPreviewUrl ?? "");
  }, [initialPath, initialPreviewUrl]);

  async function uploadFile(file: File) {
    setMessage("");

    if (!file.type.startsWith("image/")) {
      setMessage("აირჩიე ფოტოს ფაილი.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setMessage("ფოტო მაქსიმუმ 10 MB უნდა იყოს.");
      return;
    }

    setUploading(true);
    setFormUploading(true);

    try {
      const extension = safeExtension(file.name);
      const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || `image.${extension}`;
      const objectPath = `requests/${requestId}/${requestItemId ?? `temp-${crypto.randomUUID()}`}/${Date.now()}-${crypto.randomUUID()}-${filename}`;

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error("Please sign in again.");
      const { data: access } = await supabase.from("sourcing_users").select("user_id")
        .eq("user_id", user.id).eq("active", true).maybeSingle();
      if (!access) throw new Error("Sourcing access is required.");

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(objectPath, file, {
          cacheControl: "3600",
          contentType: file.type,
          upsert: false
        });

      if (uploadError) {
        setMessage(`ატვირთვა ვერ მოხერხდა: ${uploadError.message}`);
        return;
      }

      const { data: signedData, error: signedError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(objectPath, 3600);

      if (signedError) {
        setPreviewUrl("");
        setMessage(`ფოტო აიტვირთა, მაგრამ preview ვერ შეიქმნა: ${signedError.message}`);
      } else {
        setPreviewUrl(signedData.signedUrl);
        setMessage("ფოტო ატვირთულია. დააჭირე „შენახვა“-ს.");
      }

      setPath(objectPath);
    } catch (error) {
      setMessage(`ატვირთვა ვერ მოხერხდა: ${error instanceof Error ? error.message : "Network error. Please retry."}`);
    } finally {
      setUploading(false);
      setFormUploading(false);
    }
  }

  return (
    <div className="upload-box">
      <input type="hidden" name={name} value={path} readOnly />
      {path && !previewUrl && <div role="status" className="small muted">ფოტოს preview მიუწვდომელია. განაახლეთ გვერდი ან გადაამოწმეთ Storage წვდომა.</div>}

      {previewUrl ? (
        <a href={previewUrl} target="_blank" rel="noreferrer" className="upload-preview-link">
          <img className="upload-preview" src={previewUrl} alt="Product upload" />
        </a>
      ) : null}

      <div className="upload-controls">
        <label className="btn secondary upload-button">
          {uploading ? "იტვირთება..." : path ? "ფოტოს შეცვლა" : "ფოტოს ატვირთვა"}
          <input
            className="visually-hidden"
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadFile(file);
              event.currentTarget.value = "";
            }}
          />
        </label>

        {path ? (
          <button
            className="btn danger"
            type="button"
            disabled={uploading}
            onClick={() => {
              setPath("");
              setPreviewUrl("");
              setMessage("ფოტო მოხსნილია. ცვლილების დასაფიქსირებლად დააჭირე „შენახვა“-ს.");
            }}
          >
            ფოტოს მოხსნა
          </button>
        ) : null}
      </div>

      <div className="small muted">მხოლოდ ფოტოები · მაქსიმუმ 10 MB</div>
      {message ? <div role="status" aria-live="polite" className="small muted">{message}</div> : null}
    </div>
  );
}
