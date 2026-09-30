"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

export function NexoUnreadMarker({
  requestId,
  itemId,
  initialUnread,
  changedAt,
}: {
  requestId: string;
  itemId: string;
  initialUnread: boolean;
  changedAt: string | null;
}) {
  const [unread, setUnread] =
    useState(initialUnread);

  const markerRef =
    useRef<HTMLSpanElement>(null);

  const busy = useRef(false);

  useEffect(() => {
    const marker =
      markerRef.current;

    const detailsElement =
      marker?.closest("details");

    if (
      !(
        detailsElement instanceof
        HTMLDetailsElement
      )
    ) {
      return;
    }

    async function markSeen() {
      if (
        !detailsElement.open ||
        !unread ||
        !changedAt ||
        busy.current
      ) {
        return;
      }

      busy.current = true;

      try {
        const response =
          await fetch(
            `/api/requests/${requestId}/items/${itemId}/seen`,
            {
              method: "POST",
              cache: "no-store",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                seenThrough:
                  changedAt,
              }),
            }
          );

        if (response.ok) {
          setUnread(false);
        }
      } catch {
        // Keep the yellow dot if marking
        // the item as seen fails.
      } finally {
        busy.current = false;
      }
    }

    function handleToggle() {
      if (detailsElement.open) {
        void markSeen();
      }
    }

    detailsElement.addEventListener(
      "toggle",
      handleToggle
    );

    return () => {
      detailsElement.removeEventListener(
        "toggle",
        handleToggle
      );
    };
  }, [
    requestId,
    itemId,
    unread,
    changedAt,
  ]);

  return (
    <span
      ref={markerRef}
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
      }}
    >
      {unread && (
        <span
          title="Supplier updated this item"
          aria-label="Supplier update"
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "#f5c542",
            boxShadow:
              "0 0 0 2px rgba(245, 197, 66, 0.18)",
          }}
        />
      )}
    </span>
  );
}