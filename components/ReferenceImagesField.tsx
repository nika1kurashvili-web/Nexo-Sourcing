"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useItemUpload } from "@/components/RequestItemForm";

const BUCKET = "sourcing-files";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_IMAGES = 5;

type InitialImage = {
  id: string;
  path: string;
  previewUrl: string;
};

type ImageState = {
  id?: string;
  path: string;
  previewUrl: string;
  existing: boolean;
};

function safeExtension(fileName: string) {
  const raw = fileName.split(".").pop()?.toLowerCase() || "jpg";
  return raw.replace(/[^a-z0-9]/g, "") || "jpg";
}

export function ReferenceImagesField({
  requestId,
  requestItemId,
  legacyPath = "",
  legacyPreviewUrl = "",
  initialImages,
}: {
  requestId: string;
  requestItemId?: string;
  legacyPath?: string | null;
  legacyPreviewUrl?: string | null;
  initialImages?: InitialImage[];
}) {
  const supabase = useMemo(() => createClient(), []);

  const [legacyImagePath, setLegacyImagePath] = useState(
    legacyPath ?? ""
  );

  const [legacyPreview, setLegacyPreview] = useState(
    legacyPreviewUrl ?? ""
  );

  const [images, setImages] = useState<ImageState[]>(() =>
    (initialImages ?? []).map((image) => ({
      ...image,
      existing: true,
    }))
  );

  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const { setUploading: setFormUploading } = useItemUpload();

  useEffect(() => {
    setLegacyImagePath(legacyPath ?? "");
    setLegacyPreview(legacyPreviewUrl ?? "");

    setImages(
      (initialImages ?? []).map((image) => ({
        ...image,
        existing: true,
      }))
    );
  }, [legacyPath, legacyPreviewUrl, initialImages]);

  const totalImages =
    (legacyImagePath ? 1 : 0) + images.length;

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;

    setMessage("");

    const availableSlots = MAX_IMAGES - totalImages;

    if (availableSlots <= 0) {
      setMessage("Maximum 5 images are allowed.");
      return;
    }

    const selectedFiles = Array.from(files);

    const filesToUpload = selectedFiles.slice(
      0,
      availableSlots
    );

    if (selectedFiles.length > availableSlots) {
      setMessage(
        `Only ${availableSlots} more image${
          availableSlots === 1 ? "" : "s"
        } can be added.`
      );
    }

    for (const file of filesToUpload) {
      if (!file.type.startsWith("image/")) {
        setMessage("Only image files are allowed.");
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        setMessage(`${file.name} is larger than 10 MB.`);
        return;
      }
    }

    setUploading(true);
    setFormUploading(true);

    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        throw new Error("Please sign in again.");
      }

      const { data: access } = await supabase
        .from("sourcing_users")
        .select("user_id")
        .eq("user_id", user.id)
        .eq("active", true)
        .maybeSingle();

      if (!access) {
        throw new Error("Sourcing access is required.");
      }

      const folder =
        requestItemId ?? `temp-${crypto.randomUUID()}`;

      const uploadedImages: ImageState[] = [];

      for (const file of filesToUpload) {
        const extension = safeExtension(file.name);

        const cleanFilename =
          file.name
            .replace(/[^a-zA-Z0-9._-]/g, "_")
            .slice(-100) || `image.${extension}`;

        const objectPath =
          `requests/${requestId}/${folder}/` +
          `${Date.now()}-${crypto.randomUUID()}-${cleanFilename}`;

        const { error: uploadError } =
          await supabase.storage
            .from(BUCKET)
            .upload(objectPath, file, {
              cacheControl: "3600",
              contentType: file.type,
              upsert: false,
            });

        if (uploadError) {
          throw new Error(
            `${file.name}: ${uploadError.message}`
          );
        }

        const {
          data: signedData,
          error: signedError,
        } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(objectPath, 3600);

        uploadedImages.push({
          path: objectPath,
          previewUrl:
            signedError || !signedData
              ? ""
              : signedData.signedUrl,
          existing: false,
        });
      }

      setImages((current) => [
        ...current,
        ...uploadedImages,
      ]);

      setMessage(
        `${uploadedImages.length} image${
          uploadedImages.length === 1 ? "" : "s"
        } uploaded. Save the item to keep the changes.`
      );
    } catch (error) {
      setMessage(
        `Upload failed: ${
          error instanceof Error
            ? error.message
            : "Network error. Please retry."
        }`
      );
    } finally {
      setUploading(false);
      setFormUploading(false);
    }
  }

  async function removeAdditionalImage(
    image: ImageState
  ) {
    setMessage("");

    // If it was uploaded during the current unsaved edit,
    // remove the unused Storage object immediately.
    if (!image.existing) {
      const { error } = await supabase.storage
        .from(BUCKET)
        .remove([image.path]);

      if (error) {
        setMessage(
          `Unable to remove image: ${error.message}`
        );
        return;
      }
    }

    setImages((current) =>
      current.filter(
        (currentImage) =>
          currentImage.path !== image.path
      )
    );

    setMessage(
      "Image removed. Save the item to keep the change."
    );
  }

  return (
    <div className="upload-box">
      {/* Existing legacy image_url stays compatible */}
      <input
        type="hidden"
        name="image_url"
        value={legacyImagePath}
        readOnly
      />

      {/* New multi-image paths */}
      <input
        type="hidden"
        name="reference_images_json"
        value={JSON.stringify(
          images.map((image) => image.path)
        )}
        readOnly
      />

      <div
        className="small muted"
        style={{ marginBottom: 10 }}
      >
        {totalImages} / {MAX_IMAGES} images
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        {legacyImagePath && (
          <div>
            {legacyPreview ? (
              <a
                href={legacyPreview}
                target="_blank"
                rel="noreferrer"
                className="upload-preview-link"
              >
                <img
                  className="upload-preview"
                  src={legacyPreview}
                  alt="Product reference"
                  loading="lazy"
                  decoding="async"
                />
              </a>
            ) : (
              <div className="small muted">
                Preview unavailable
              </div>
            )}

            <div style={{ marginTop: 5 }}>
              <button
                type="button"
                className="btn danger"
                disabled={uploading}
                onClick={() => {
                  setLegacyImagePath("");
                  setLegacyPreview("");
                  setMessage(
                    "Image removed. Save the item to keep the change."
                  );
                }}
              >
                Remove
              </button>
            </div>
          </div>
        )}

        {images.map((image) => (
          <div key={image.path}>
            {image.previewUrl ? (
              <a
                href={image.previewUrl}
                target="_blank"
                rel="noreferrer"
                className="upload-preview-link"
              >
                <img
                  className="upload-preview"
                  src={image.previewUrl}
                  alt="Product reference"
                  loading="lazy"
                  decoding="async"
                />
              </a>
            ) : (
              <div className="small muted">
                Preview unavailable
              </div>
            )}

            <div style={{ marginTop: 5 }}>
              <button
                type="button"
                className="btn danger"
                disabled={uploading}
                onClick={() =>
                  void removeAdditionalImage(image)
                }
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <div
        className="upload-controls"
        style={{ marginTop: 12 }}
      >
        <label className="btn secondary upload-button">
          {uploading
            ? "Uploading..."
            : totalImages >= MAX_IMAGES
            ? "Maximum 5 Images"
            : "Add Images"}

          <input
            className="visually-hidden"
            type="file"
            accept="image/*"
            multiple
            disabled={
              uploading ||
              totalImages >= MAX_IMAGES
            }
            onChange={(event) => {
              void uploadFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>

      <div className="small muted">
        Images only · Maximum 10 MB each · Maximum 5 images per product
      </div>

      {message && (
        <div
          role="status"
          aria-live="polite"
          className="small muted"
          style={{ marginTop: 6 }}
        >
          {message}
        </div>
      )}
    </div>
  );
}