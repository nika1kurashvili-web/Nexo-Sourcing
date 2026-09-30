import {
  requireSourcingAccess,
} from "@/lib/auth";

export const dynamic =
  "force-dynamic";

export const revalidate = 0;

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      requestId: string;
      itemId: string;
    }>;
  }
) {
  try {
    const {
      requestId,
      itemId,
    } = await params;

    const body = await request
      .json()
      .catch(() => null);

    const seenThrough =
      typeof body?.seenThrough === "string"
        ? body.seenThrough
        : null;

    if (
      !seenThrough ||
      !Number.isFinite(
        Date.parse(seenThrough)
      )
    ) {
      return Response.json(
        {
          error:
            "Invalid seen timestamp.",
        },
        {
          status: 400,
          headers: {
            "Cache-Control":
              "no-store",
          },
        }
      );
    }

    const { supabase } =
      await requireSourcingAccess();

    const {
      data: item,
      error,
    } = await supabase
      .from(
        "sourcing_request_items"
      )
      .select(
        "id,supplier_changed_at,nexo_seen_at"
      )
      .eq("id", itemId)
      .eq(
        "request_id",
        requestId
      )
      .maybeSingle();

    if (
      error ||
      !item
    ) {
      return new Response(
        null,
        {
          status: 404,
          headers: {
            "Cache-Control":
              "no-store",
          },
        }
      );
    }

    if (
      !item.supplier_changed_at
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers: {
            "Cache-Control":
              "no-store",
          },
        }
      );
    }

    if (
      Date.parse(
        item.supplier_changed_at
      ) !==
      Date.parse(seenThrough)
    ) {
      return new Response(
        null,
        {
          status: 409,
          headers: {
            "Cache-Control":
              "no-store",
          },
        }
      );
    }

    const {
      data: updated,
      error: updateError,
    } = await supabase
      .from(
        "sourcing_request_items"
      )
      .update({
        nexo_seen_at:
          item.supplier_changed_at,
      })
      .eq("id", itemId)
      .eq(
        "request_id",
        requestId
      )
      .eq(
        "supplier_changed_at",
        item.supplier_changed_at
      )
      .select("id")
      .maybeSingle();

    if (
      updateError ||
      !updated
    ) {
      return new Response(
        null,
        {
          status: 409,
          headers: {
            "Cache-Control":
              "no-store",
          },
        }
      );
    }

    return new Response(
      null,
      {
        status: 204,
        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  } catch {
    return new Response(
      null,
      {
        status: 401,
        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  }
}