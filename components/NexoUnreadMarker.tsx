"use client";

import {
  useEffect,
  useRef,
} from "react";
import { useItemSeen } from "@/components/useItemSeen";

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
  const { unread, markSeen } = useItemSeen(
    `/api/requests/${requestId}/items/${itemId}/seen`, changedAt, initialUnread
  );
  const markerRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const details = markerRef.current?.closest("details");
    if (!(details instanceof HTMLDetailsElement)) return;
    const handleToggle = () => { if (details.open) void markSeen(); };
    details.addEventListener("toggle", handleToggle);
    return () => details.removeEventListener("toggle", handleToggle);
  }, [markSeen]);

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
