"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSourcingAccess } from "@/lib/auth";
import {
  formatRequestDate,
  parseDeadlineInput,
} from "@/lib/request-dates";

function clean(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function numberOrNull(
  value: FormDataEntryValue | null
) {
  const text = String(value ?? "").trim();

  if (!text) return null;

  const num = Number(text);

  return Number.isFinite(num) ? num : null;
}

const STORAGE_BUCKET = "sourcing-files";
const MAX_REFERENCE_IMAGES = 5;

function sameValue(
  previous: unknown,
  next: unknown
) {
  if (
    (previous === null ||
      previous === undefined ||
      previous === "") &&
    (next === null ||
      next === undefined ||
      next === "")
  ) {
    return true;
  }

  return String(previous) === String(next);
}

function parseReferenceImagePaths(
  value: FormDataEntryValue | null,
  requestId: string
) {
  const raw = String(value ?? "").trim();

  if (!raw) return [];

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "Invalid reference image data."
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      "Invalid reference image data."
    );
  }

  if (
    parsed.some(
      (value) => typeof value !== "string"
    )
  ) {
    throw new Error(
      "Invalid reference image data."
    );
  }

  const paths = Array.from(
    new Set(
      (parsed as string[])
        .map((path) => path.trim())
        .filter(Boolean)
    )
  );

  for (const path of paths) {
    if (
      /^https?:\/\//i.test(path) ||
      !path.startsWith(
        `requests/${requestId}/`
      ) ||
      path.split("/").some(
        (part) => part === ".." || part === "."
      ) ||
      path.includes("/supplier/")
    ) {
      throw new Error(
        "Invalid reference image path."
      );
    }
  }

  return paths;
}

async function syncReferenceImages(
  supabase: any,
  userId: string,
  requestId: string,
  requestItemId: string,
  legacyImage: string | null,
  requestedPaths: string[]
) {
  const total =
    (legacyImage ? 1 : 0) +
    requestedPaths.length;

  if (total > MAX_REFERENCE_IMAGES) {
    throw new Error(
      "Maximum 5 reference images are allowed per product."
    );
  }

  const {
    data: existing,
    error: readError,
  } = await supabase
    .from("sourcing_request_item_images")
    .select(
      "id, object_path, sort_order"
    )
    .eq(
      "request_item_id",
      requestItemId
    );

  if (readError) throw readError;

  const existingRows = existing ?? [];

  const requestedSet =
    new Set(requestedPaths);

  const existingPathSet =
    new Set(
      existingRows.map(
        (row: any) => row.object_path
      )
    );

  const removedRows =
    existingRows.filter(
      (row: any) =>
        !requestedSet.has(
          row.object_path
        )
    );

  if (removedRows.length) {
    const { error: deleteError } =
      await supabase
        .from(
          "sourcing_request_item_images"
        )
        .delete()
        .in(
          "id",
          removedRows.map(
            (row: any) => row.id
          )
        );

    if (deleteError) {
      throw deleteError;
    }
  }

  const newPaths =
    requestedPaths.filter(
      (path) =>
        !existingPathSet.has(path)
    );

  if (newPaths.length) {
    const { error: insertError } =
      await supabase
        .from(
          "sourcing_request_item_images"
        )
        .insert(
          newPaths.map((path) => ({
            request_item_id:
              requestItemId,
            object_path: path,
            created_by: userId,
            sort_order:
              requestedPaths.indexOf(
                path
              ),
          }))
        );

    if (insertError) {
      throw insertError;
    }
  }

  for (
    let index = 0;
    index < requestedPaths.length;
    index++
  ) {
    const { error: orderError } =
      await supabase
        .from(
          "sourcing_request_item_images"
        )
        .update({
          sort_order: index,
        })
        .eq(
          "request_item_id",
          requestItemId
        )
        .eq(
          "object_path",
          requestedPaths[index]
        );

    if (orderError) {
      throw orderError;
    }
  }

  const removedPaths =
    removedRows.map(
      (row: any) =>
        row.object_path as string
    );

  if (removedPaths.length) {
    await supabase.storage
      .from(STORAGE_BUCKET)
      .remove(removedPaths);
  }

  /*
   * Adding/removing a Nexo reference image is
   * supplier-visible, therefore it creates
   * a new unread update for the supplier.
   */
  if (
    newPaths.length ||
    removedPaths.length
  ) {
    const { error: changedError } =
      await supabase
        .from(
          "sourcing_request_items"
        )
        .update({
          nexo_changed_at:
            new Date().toISOString(),
        })
        .eq("id", requestItemId)
        .eq("request_id", requestId);

    if (changedError) {
      throw changedError;
    }
  }

  return {
    added: newPaths,
    removed: removedPaths,
  };
}

async function addLog(
  requestId: string | null,
  requestItemId: string | null,
  action: string,
  details?: string | null
) {
  const { supabase, user } =
    await requireSourcingAccess();

  await supabase
    .from("sourcing_activity_log")
    .insert({
      request_id: requestId,
      request_item_id: requestItemId,
      user_id: user.id,
      action,
      details: details ?? null,
    });
}

export async function loginAction(
  formData: FormData
) {
  const supabase =
    await createClient();

  const email = String(
    formData.get("email") ?? ""
  ).trim();

  const password = String(
    formData.get("password") ?? ""
  );

  const { data, error } =
    await supabase.auth
      .signInWithPassword({
        email,
        password,
      });

  if (error || !data.user) {
    redirect(
      "/login?error=invalid"
    );
  }

  const { data: sourcingUser } =
    await supabase
      .from("sourcing_users")
      .select("user_id, active")
      .eq(
        "user_id",
        data.user.id
      )
      .eq("active", true)
      .maybeSingle();

  if (!sourcingUser) {
    await supabase.auth.signOut();

    redirect(
      "/login?error=no-access"
    );
  }

  redirect("/dashboard");
}

export async function logoutAction() {
  const supabase =
    await createClient();

  await supabase.auth.signOut();

  redirect("/login");
}

export async function createCompanyAction(
  formData: FormData
) {
  const { supabase } =
    await requireSourcingAccess();

  const { error } =
    await supabase
      .from(
        "sourcing_companies"
      )
      .insert({
        name: clean(
          formData.get("name")
        ),
        contact_name: clean(
          formData.get(
            "contact_name"
          )
        ),
        phone: clean(
          formData.get("phone")
        ),
        email: clean(
          formData.get("email")
        ),
        notes: clean(
          formData.get("notes")
        ),
      });

  if (error) {
    redirect(
      "/companies?error=create"
    );
  }

  revalidatePath("/companies");
}

export async function createSupplierAction(
  formData: FormData
) {
  const { supabase } =
    await requireSourcingAccess();

  const { error } =
    await supabase
      .from(
        "sourcing_suppliers"
      )
      .insert({
        name: clean(
          formData.get("name")
        ),
        contact_name: clean(
          formData.get(
            "contact_name"
          )
        ),
        phone: clean(
          formData.get("phone")
        ),
        email: clean(
          formData.get("email")
        ),
        wechat: clean(
          formData.get("wechat")
        ),
        notes: clean(
          formData.get("notes")
        ),
      });

  if (error) {
    redirect(
      "/suppliers?error=create"
    );
  }

  revalidatePath("/suppliers");
}

export async function updateCompanyAction(formData: FormData): Promise<{ error: string } | { success: true }> {
  const { supabase } = await requireSourcingAccess();
  const id = formData.get("id");
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { error: "Invalid company." };
  }
  const fields = ["name", "contact_name", "phone", "email", "notes"] as const;
  const values = {} as Record<typeof fields[number], string | null>;
  for (const field of fields) {
    const value = formData.get(field);
    if (value !== null && typeof value !== "string") return { error: "Invalid company details." };
    values[field] = clean(value);
  }
  if (!values.name) return { error: "Company name is required." };
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    return { error: "Enter a valid email address." };
  }
  try {
    const { data, error } = await supabase.from("sourcing_companies")
      .update(values).eq("id", id).select("id").maybeSingle();
    if (error) return { error: "Unable to save company. Please try again." };
    if (!data) return { error: "Company not found or you do not have permission to edit it." };
  } catch {
    return { error: "Unable to save company. Please try again." };
  }
  revalidatePath("/companies");
  revalidatePath("/requests", "layout");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function updateSupplierAction(formData: FormData): Promise<{ error: string } | { success: true }> {
  const { supabase } = await requireSourcingAccess();
  const id = formData.get("id");
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { error: "Invalid supplier." };
  }
  const fields = ["name", "contact_name", "phone", "email", "wechat", "notes"] as const;
  const values = {} as Record<typeof fields[number], string | null>;
  for (const field of fields) {
    const value = formData.get(field);
    if (value !== null && typeof value !== "string") return { error: "Invalid supplier details." };
    values[field] = clean(value);
  }
  if (!values.name) return { error: "Supplier name is required." };
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    return { error: "Enter a valid email address." };
  }
  try {
    const { data, error } = await supabase.from("sourcing_suppliers")
      .update(values).eq("id", id).select("id").maybeSingle();
    if (error) return { error: "Unable to save supplier. Please try again." };
    if (!data) return { error: "Supplier not found or you do not have permission to edit it." };
  } catch {
    return { error: "Unable to save supplier. Please try again." };
  }
  revalidatePath("/suppliers");
  revalidatePath("/requests", "layout");
  return { success: true };
}

export async function createRequestAction(
  formData: FormData
) {
  const { supabase, user } =
    await requireSourcingAccess();

  let deadlineAt: string | null;

  try {
    deadlineAt =
      parseDeadlineInput(
        formData.get(
          "deadline_at"
        )
      );
  } catch {
    redirect(
      "/requests?error=deadline"
    );
  }

  const { data, error } =
    await supabase
      .from(
        "sourcing_requests"
      )
      .insert({
        company_id: clean(
          formData.get(
            "company_id"
          )
        ),
        title: clean(
          formData.get("title")
        ),
        client_contact: clean(
          formData.get(
            "client_contact"
          )
        ),
        notes: clean(
          formData.get("notes")
        ),
        created_by: user.id,
        ...(deadlineAt
          ? {
              deadline_at:
                deadlineAt,
            }
          : {}),
      })
      .select(
        "id, request_no"
      )
      .single();

  if (error || !data) {
    redirect(
      "/requests?error=create"
    );
  }

  await addLog(
    data.id,
    null,
    "request_created",
    data.request_no
  );

  revalidatePath("/requests");
  revalidatePath("/dashboard");

  redirect(
    `/requests/${data.id}`
  );
}

export async function updateRequestDeadlineAction(
  formData: FormData
) {
  const { supabase } =
    await requireSourcingAccess();

  const id = String(
    formData.get("id") ?? ""
  );

  let deadlineAt: string | null;

  try {
    deadlineAt =
      parseDeadlineInput(
        formData.get(
          "deadline_at"
        )
      );
  } catch {
    return {
      error:
        "Enter a valid deadline date and time.",
    };
  }

  const { data, error } =
    await supabase
      .from(
        "sourcing_requests"
      )
      .update({
        deadline_at: deadlineAt,
        updated_at:
          new Date().toISOString(),
      })
      .eq("id", id)
      .select("id")
      .single();

  if (error || !data) {
    return {
      error:
        "Unable to save deadline. Check request access and that the deadline migration has been applied.",
    };
  }

  await addLog(
    id,
    null,
    "request_deadline_changed",
    deadlineAt
      ? `${formatRequestDate(
          deadlineAt,
          true
        )} (Tbilisi time)`
      : "Deadline removed"
  );

  revalidatePath(
    `/requests/${id}`
  );

  revalidatePath("/requests");
  revalidatePath("/dashboard");
}

export async function updateRequestStatusAction(
  formData: FormData
) {
  const { supabase } =
    await requireSourcingAccess();

  const id = String(
    formData.get("id") ?? ""
  );

  const status = String(
    formData.get("status") ?? ""
  );

  const { error } =
    await supabase
      .from(
        "sourcing_requests"
      )
      .update({ status })
      .eq("id", id);

  if (!error) {
    await addLog(
      id,
      null,
      "request_status_changed",
      status
    );
  }

  revalidatePath(
    `/requests/${id}`
  );

  revalidatePath("/requests");
  revalidatePath("/dashboard");
}

export async function createRequestItemAction(
  formData: FormData
) {
  const { supabase, user } =
    await requireSourcingAccess();

  const requestId = String(
    formData.get(
      "request_id"
    ) ?? ""
  );

  const legacyImage = clean(
    formData.get("image_url")
  );

  let referenceImages: string[];

  try {
    referenceImages =
      parseReferenceImagePaths(
        formData.get(
          "reference_images_json"
        ),
        requestId
      );
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Invalid reference images.",
    };
  }

  if (
    (legacyImage ? 1 : 0) +
      referenceImages.length >
    MAX_REFERENCE_IMAGES
  ) {
    return {
      error:
        "Maximum 5 reference images are allowed per product.",
    };
  }

  const now =
    new Date().toISOString();

  const { data, error } =
    await supabase
      .from(
        "sourcing_request_items"
      )
      .insert({
        request_id: requestId,

        product_name: clean(
          formData.get(
            "product_name"
          )
        ),

        quantity: numberOrNull(
          formData.get(
            "quantity"
          )
        ),

        unit:
          clean(
            formData.get("unit")
          ) ?? "pcs",

        specifications: clean(
          formData.get(
            "specifications"
          )
        ),

        image_url: legacyImage,

        supplier_id: clean(
          formData.get(
            "supplier_id"
          )
        ),

        supplier_status:
          clean(
            formData.get(
              "supplier_status"
            )
          ) ?? "not_sent",

        china_price: numberOrNull(
          formData.get(
            "china_price"
          )
        ),

        currency:
          clean(
            formData.get(
              "currency"
            )
          ) ?? "USD",

        client_price: numberOrNull(
          formData.get(
            "client_price"
          )
        ),

        moq: numberOrNull(
          formData.get("moq")
        ),

        lead_time_days:
          numberOrNull(
            formData.get(
              "lead_time_days"
            )
          ),

        box_length_cm:
          numberOrNull(
            formData.get(
              "box_length_cm"
            )
          ),

        box_width_cm:
          numberOrNull(
            formData.get(
              "box_width_cm"
            )
          ),

        box_height_cm:
          numberOrNull(
            formData.get(
              "box_height_cm"
            )
          ),

        weight_kg:
          numberOrNull(
            formData.get(
              "weight_kg"
            )
          ),

        supplier_comment: clean(
          formData.get(
            "supplier_comment"
          )
        ),

        internal_comment: clean(
          formData.get(
            "internal_comment"
          )
        ),

        client_comment: clean(
          formData.get(
            "client_comment"
          )
        ),

        /*
         * New item = new supplier-visible
         * information.
         */
        nexo_changed_at: now,
      })
      .select(
        "id, product_name"
      )
      .single();

  if (error || !data) {
    return {
      error:
        `Unable to create item: ${
          error?.message ??
          "No item returned"
        }`,
    };
  }

  try {
    const imageChanges =
      await syncReferenceImages(
        supabase,
        user.id,
        requestId,
        data.id,
        legacyImage,
        referenceImages
      );

    if (
      legacyImage &&
      !/^https?:\/\//i.test(
        legacyImage
      )
    ) {
      await addLog(
        requestId,
        data.id,
        "item_image_uploaded",
        legacyImage
      );
    }

    for (
      const path of
      imageChanges.added
    ) {
      await addLog(
        requestId,
        data.id,
        "item_image_uploaded",
        path
      );
    }
  } catch (imageError) {
    await supabase
      .from(
        "sourcing_request_items"
      )
      .delete()
      .eq("id", data.id)
      .eq(
        "request_id",
        requestId
      );

    if (
      referenceImages.length
    ) {
      await supabase.storage
        .from(STORAGE_BUCKET)
        .remove(
          referenceImages
        );
    }

    return {
      error:
        `Unable to save item images: ${
          imageError instanceof
          Error
            ? imageError.message
            : "Unknown image error"
        }`,
    };
  }

  await supabase
    .from(
      "sourcing_requests"
    )
    .update({
      updated_at:
        new Date().toISOString(),
    })
    .eq("id", requestId);

  await addLog(
    requestId,
    data.id,
    "item_created",
    data.product_name
  );

  revalidatePath(
    `/requests/${requestId}`
  );

  revalidatePath("/dashboard");
}

export async function updateRequestItemAction(
  formData: FormData
) {
  const { supabase, user } =
    await requireSourcingAccess();

  const id = String(
    formData.get("id") ?? ""
  );

  const requestId = String(
    formData.get(
      "request_id"
    ) ?? ""
  );

  const legacyImage = clean(
    formData.get("image_url")
  );

  let referenceImages: string[];

  try {
    referenceImages =
      parseReferenceImagePaths(
        formData.get(
          "reference_images_json"
        ),
        requestId
      );
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Invalid reference images.",
    };
  }

  if (
    (legacyImage ? 1 : 0) +
      referenceImages.length >
    MAX_REFERENCE_IMAGES
  ) {
    return {
      error:
        "Maximum 5 reference images are allowed per product.",
    };
  }

  /*
   * Values that the supplier can actually see.
   *
   * Deliberately excluded:
   * - client_price
   * - internal_comment
   * - client_comment
   */
  const nextSupplierVisible = {
    product_name: clean(
      formData.get(
        "product_name"
      )
    ),

    quantity: numberOrNull(
      formData.get(
        "quantity"
      )
    ),

    unit:
      clean(
        formData.get("unit")
      ) ?? "pcs",

    specifications: clean(
      formData.get(
        "specifications"
      )
    ),

    image_url: legacyImage,

    supplier_id: clean(
      formData.get(
        "supplier_id"
      )
    ),

    supplier_status:
      clean(
        formData.get(
          "supplier_status"
        )
      ) ?? "not_sent",

    china_price: numberOrNull(
      formData.get(
        "china_price"
      )
    ),

    currency:
      clean(
        formData.get(
          "currency"
        )
      ) ?? "USD",

    moq: numberOrNull(
      formData.get("moq")
    ),

    lead_time_days:
      numberOrNull(
        formData.get(
          "lead_time_days"
        )
      ),

    box_length_cm:
      numberOrNull(
        formData.get(
          "box_length_cm"
        )
      ),

    box_width_cm:
      numberOrNull(
        formData.get(
          "box_width_cm"
        )
      ),

    box_height_cm:
      numberOrNull(
        formData.get(
          "box_height_cm"
        )
      ),

    weight_kg:
      numberOrNull(
        formData.get(
          "weight_kg"
        )
      ),

    supplier_comment: clean(
      formData.get(
        "supplier_comment"
      )
    ),
  };

  const {
    data: previous,
    error: readError,
  } = await supabase
    .from(
      "sourcing_request_items"
    )
    .select(`
      image_url,
      product_name,
      quantity,
      unit,
      specifications,
      supplier_id,
      supplier_status,
      china_price,
      currency,
      moq,
      lead_time_days,
      box_length_cm,
      box_width_cm,
      box_height_cm,
      weight_kg,
      supplier_comment
    `)
    .eq("id", id)
    .eq(
      "request_id",
      requestId
    )
    .single();

  if (
    readError ||
    !previous
  ) {
    return {
      error:
        "Item unavailable.",
    };
  }

  const supplierVisibleChanged =
    !sameValue(
      previous.product_name,
      nextSupplierVisible.product_name
    ) ||
    !sameValue(
      previous.quantity,
      nextSupplierVisible.quantity
    ) ||
    !sameValue(
      previous.unit,
      nextSupplierVisible.unit
    ) ||
    !sameValue(
      previous.specifications,
      nextSupplierVisible.specifications
    ) ||
    !sameValue(
      previous.image_url,
      nextSupplierVisible.image_url
    ) ||
    !sameValue(
      previous.supplier_id,
      nextSupplierVisible.supplier_id
    ) ||
    !sameValue(
      previous.supplier_status,
      nextSupplierVisible.supplier_status
    ) ||
    !sameValue(
      previous.china_price,
      nextSupplierVisible.china_price
    ) ||
    !sameValue(
      previous.currency,
      nextSupplierVisible.currency
    ) ||
    !sameValue(
      previous.moq,
      nextSupplierVisible.moq
    ) ||
    !sameValue(
      previous.lead_time_days,
      nextSupplierVisible.lead_time_days
    ) ||
    !sameValue(
      previous.box_length_cm,
      nextSupplierVisible.box_length_cm
    ) ||
    !sameValue(
      previous.box_width_cm,
      nextSupplierVisible.box_width_cm
    ) ||
    !sameValue(
      previous.box_height_cm,
      nextSupplierVisible.box_height_cm
    ) ||
    !sameValue(
      previous.weight_kg,
      nextSupplierVisible.weight_kg
    ) ||
    !sameValue(
      previous.supplier_comment,
      nextSupplierVisible.supplier_comment
    );

  const { data: updated, error } =
    await supabase
      .from(
        "sourcing_request_items"
      )
      .update({
        ...nextSupplierVisible,

        /*
         * These fields are NOT visible to the
         * supplier and therefore do not create
         * a supplier unread notification.
         */
        client_price: numberOrNull(
          formData.get(
            "client_price"
          )
        ),

        internal_comment: clean(
          formData.get(
            "internal_comment"
          )
        ),

        client_comment: clean(
          formData.get(
            "client_comment"
          )
        ),

        ...(supplierVisibleChanged
          ? {
              nexo_changed_at:
                new Date().toISOString(),
            }
          : {}),
      })
      .eq("id", id)
      .eq(
        "request_id",
        requestId
      )
      .select("id")
      .single();

  if (
    error ||
    !updated
  ) {
    return {
      error:
        `Unable to save item: ${
          error?.message ??
          "Item unavailable"
        }`,
    };
  }

  try {
    const imageChanges =
      await syncReferenceImages(
        supabase,
        user.id,
        requestId,
        id,
        legacyImage,
        referenceImages
      );

    if (
      legacyImage &&
      legacyImage !==
        previous.image_url &&
      !/^https?:\/\//i.test(
        legacyImage
      )
    ) {
      await addLog(
        requestId,
        id,
        "item_image_uploaded",
        legacyImage
      );
    }

    for (
      const path of
      imageChanges.added
    ) {
      await addLog(
        requestId,
        id,
        "item_image_uploaded",
        path
      );
    }

    for (
      const path of
      imageChanges.removed
    ) {
      await addLog(
        requestId,
        id,
        "item_image_deleted",
        path
      );
    }

    /*
     * Remove old legacy Storage image when
     * it was removed or replaced.
     */
    if (
      previous.image_url &&
      previous.image_url !==
        legacyImage &&
      !/^https?:\/\//i.test(
        previous.image_url
      )
    ) {
      await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([
          previous.image_url,
        ]);
    }
  } catch (imageError) {
    return {
      error:
        `Item details were saved, but the image gallery could not be updated: ${
          imageError instanceof
          Error
            ? imageError.message
            : "Unknown image error"
        }`,
    };
  }

  await supabase
    .from(
      "sourcing_requests"
    )
    .update({
      updated_at:
        new Date().toISOString(),
    })
    .eq("id", requestId);

  await addLog(
    requestId,
    id,
    "item_updated",
    clean(
      formData.get(
        "product_name"
      )
    )
  );

  revalidatePath(
    `/requests/${requestId}`
  );

  revalidatePath("/dashboard");
}

export async function deleteRequestItemAction(
  formData: FormData
) {
  const { supabase } =
    await requireSourcingAccess();

  const id = String(
    formData.get("id") ?? ""
  );

  const requestId = String(
    formData.get(
      "request_id"
    ) ?? ""
  );

  const { error } =
    await supabase
      .from(
        "sourcing_request_items"
      )
      .delete()
      .eq("id", id)
      .eq("request_id", requestId);

  if (!error) {
    await addLog(
      requestId,
      null,
      "item_deleted",
      id
    );
  }

  revalidatePath(
    `/requests/${requestId}`
  );

  revalidatePath("/dashboard");
}
