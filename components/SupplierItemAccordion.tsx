"use client";

import { type ReactNode } from "react";
import { useItemSeen } from "@/components/useItemSeen";

export function SupplierItemAccordion({
  token,
  itemId,
  itemNo,
  productName,
  quantity,
  unit,
  statusLabel,
  initialUnread,
  changedAt,
  children,
}: {
  token: string;
  itemId: string;
  itemNo: number;
  productName: string;
  quantity: number | null;
  unit: string | null;
  statusLabel: string;
  initialUnread: boolean;
  changedAt: string | null;
  children: ReactNode;
}) {
  const { unread, markSeen } = useItemSeen(
    `/api/supplier/${token}/items/${itemId}/seen`, changedAt, initialUnread
  );

  return (
    <details
      className="item-card item-accordion"
      onToggle={(event) => {
        if (event.currentTarget.open) {
          void markSeen();
        }
      }}
    >
      <summary className="item-summary">
        <span className="item-summary-title">
          {unread && (
            <span
              title="Updated since your last view"
              aria-label="New update"
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#f5c542",
                flexShrink: 0,
                boxShadow:
                  "0 0 0 2px rgba(245, 197, 66, 0.18)",
              }}
            />
          )}

          <span className="item-number">
            ITEM-
            {String(itemNo).padStart(
              2,
              "0"
            )}
          </span>

          <span className="item-title">
            {productName}
          </span>
        </span>

        {quantity != null && (
          <span className="small">
            Quantity: {quantity}{" "}
            {unit ?? "pcs"}
          </span>
        )}

        <span className="badge">
          {statusLabel}
        </span>

        <svg
          className="item-chevron"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>

      {children}
    </details>
  );
}