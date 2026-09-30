import {
  BUCKET,
  scopedItem,
  supplierScope,
} from "@/lib/supplier-portal";

import {
  MAX_IMAGE_BYTES,
  UUID_PATTERN,
  imageMime,
} from "@/lib/supplier-validation";

import {
  PRIVATE_HEADERS,
  supplierDenied,
} from "@/lib/supplier-http";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      token: string;
      itemId: string;
      imageId: string;
    }>;
  }
) {
  try {
    const {
      token,
      itemId,
      imageId,
    } = await params;

    const scope = await supplierScope(token);
    const item = await scopedItem(
      scope,
      itemId
    );

    let path: string | null = null;

    let imageType:
      | "legacy-reference"
      | "reference"
      | "supplier";

    let referenceImageId: string | null =
      null;

    // ---------------------------------
    // Legacy Nexo reference image
    // ---------------------------------

    if (imageId === "reference") {
      imageType = "legacy-reference";
      path = item.image_url;
    }

    // ---------------------------------
    // New Nexo reference images
    // URL format: ref-UUID
    // ---------------------------------

    else if (imageId.startsWith("ref-")) {
      imageType = "reference";

      referenceImageId =
        imageId.slice(4);

      if (
        !UUID_PATTERN.test(
          referenceImageId
        )
      ) {
        return supplierDenied();
      }

      const { data, error } =
        await scope.db
          .from(
            "sourcing_request_item_images"
          )
          .select("object_path")
          .eq("id", referenceImageId)
          .eq(
            "request_item_id",
            itemId
          )
          .maybeSingle();

      if (error || !data) {
        return supplierDenied();
      }

      path = data.object_path;
    }

    // ---------------------------------
    // Supplier's own uploaded images
    // ---------------------------------

    else {
      imageType = "supplier";

      if (!UUID_PATTERN.test(imageId)) {
        return supplierDenied();
      }

      const { data, error } =
        await scope.db
          .from(
            "sourcing_supplier_images"
          )
          .select("object_path")
          .eq("id", imageId)
          .eq(
            "request_item_id",
            itemId
          )
          .eq(
            "request_id",
            scope.link.request_id
          )
          .eq(
            "supplier_id",
            scope.link.supplier_id
          )
          .eq("ready", true)
          .maybeSingle();

      if (error || !data) {
        return supplierDenied();
      }

      path = data.object_path;
    }

    // Never allow arbitrary paths.
    if (
      !path ||
      !path.startsWith(
        `requests/${scope.link.request_id}/`
      ) ||
      path.includes("..")
    ) {
      return supplierDenied();
    }

    const {
      data: signed,
      error: signedError,
    } = await scope.db.storage
      .from(BUCKET)
      .createSignedUrl(path, 15);

    if (signedError || !signed) {
      return supplierDenied();
    }

    const download = await fetch(
      signed.signedUrl,
      {
        cache: "no-store",
        redirect: "error",
      }
    );

    if (!download.ok) {
      return supplierDenied();
    }

    const file = await download.blob();

    if (file.size > MAX_IMAGE_BYTES) {
      return supplierDenied();
    }

    const mime = imageMime(
      new Uint8Array(
        await file
          .slice(0, 16)
          .arrayBuffer()
      )
    );

    if (!mime) {
      return supplierDenied();
    }

    // ---------------------------------
    // Recheck authorization after file
    // download, before sending bytes.
    // ---------------------------------

    const latest =
      await supplierScope(token);

    const currentItem =
      await scopedItem(
        latest,
        itemId
      );

    if (
      imageType ===
        "legacy-reference" &&
      currentItem.image_url !== path
    ) {
      return supplierDenied();
    }

    if (
      imageType === "reference" &&
      referenceImageId
    ) {
      const {
        data: currentReference,
        error: currentReferenceError,
      } = await latest.db
        .from(
          "sourcing_request_item_images"
        )
        .select("object_path")
        .eq(
          "id",
          referenceImageId
        )
        .eq(
          "request_item_id",
          itemId
        )
        .maybeSingle();

      if (
        currentReferenceError ||
        !currentReference ||
        currentReference.object_path !==
          path
      ) {
        return supplierDenied();
      }
    }

    if (imageType === "supplier") {
      const {
        data: currentSupplierImage,
        error:
          currentSupplierImageError,
      } = await latest.db
        .from(
          "sourcing_supplier_images"
        )
        .select("object_path")
        .eq("id", imageId)
        .eq(
          "request_item_id",
          itemId
        )
        .eq(
          "request_id",
          latest.link.request_id
        )
        .eq(
          "supplier_id",
          latest.link.supplier_id
        )
        .eq("ready", true)
        .maybeSingle();

      if (
        currentSupplierImageError ||
        !currentSupplierImage ||
        currentSupplierImage.object_path !==
          path
      ) {
        return supplierDenied();
      }
    }

    return new Response(file.stream(), {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": mime,
        "Content-Disposition":
          "inline",
      },
    });
  } catch {
    return supplierDenied();
  }
}