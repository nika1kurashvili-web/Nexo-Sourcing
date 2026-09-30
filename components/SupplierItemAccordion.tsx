import {
  scopedItem,
  supplierScope,
} from "@/lib/supplier-portal";

import {
  PRIVATE_HEADERS,
  supplierDenied,
} from "@/lib/supplier-http";

export const dynamic =
  "force-dynamic";

export const revalidate = 0;

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      token: string;
      itemId: string;
    }>;
  }
) {
  try {
    const {
      token,
      itemId,
    } = await params;

    const body =
      await request.json().catch(
        () => null
      );

    const seenThrough =
      typeof body?.seenThrough ===
      "string"
        ? body.seenThrough
        : null;

    if (
      !seenThrough ||
      !Number.isFinite(
        Date.parse(seenThrough)
      )
    ) {
      return supplierDenied();
    }

    /*
     * Validate token + supplier +
     * request + item assignment.
     */
    const scope =
      await supplierScope(token);

    const item =
      await scopedItem(
        scope,
        itemId
      );

    /*
     * The browser may only acknowledge
     * exactly the Nexo update it actually
     * received with the rendered page.
     *
     * If Nexo changed the item again after
     * the supplier loaded the page, do NOT
     * mark the newer change as seen.
     */
    if (
      !item.nexo_changed_at ||
      Date.parse(
        item.nexo_changed_at
      ) !==
        Date.parse(
          seenThrough
        )
    ) {
      return new Response(
        null,
        {
          status: 409,
          headers:
            PRIVATE_HEADERS,
        }
      );
    }

    /*
     * Conditional update protects against
     * a Nexo edit occurring between the
     * validation above and this update.
     */
    const {
      data,
      error,
    } = await scope.db
      .from(
        "sourcing_request_items"
      )
      .update({
        supplier_seen_at:
          seenThrough,
      })
      .eq("id", itemId)
      .eq(
        "request_id",
        scope.link.request_id
      )
      .eq(
        "supplier_id",
        scope.link.supplier_id
      )
      .eq(
        "nexo_changed_at",
        item.nexo_changed_at
      )
      .select("id")
      .maybeSingle();

    if (
      error ||
      !data
    ) {
      return new Response(
        null,
        {
          status: 409,
          headers:
            PRIVATE_HEADERS,
        }
      );
    }

    /*
     * Recheck the share link after write
     * so revoked/expired links cannot
     * continue normally.
     */
    const latest =
      await supplierScope(token);

    await scopedItem(
      latest,
      itemId
    );

    return new Response(
      null,
      {
        status: 204,
        headers:
          PRIVATE_HEADERS,
      }
    );
  } catch {
    return supplierDenied();
  }
}