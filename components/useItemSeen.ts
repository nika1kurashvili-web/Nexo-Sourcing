"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function useItemSeen(endpoint: string, changedAt: string | null, initialUnread: boolean) {
  const router = useRouter();
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const busy = useRef(false);
  // A new version becomes unread even when an older acknowledgement is in flight.
  const unread = initialUnread && !!changedAt && acknowledged !== changedAt;
  const markSeen = useCallback(async () => {
    if (!unread || !changedAt || busy.current) return;
    const renderedVersion = changedAt;
    busy.current = true;
    try {
      const response = await fetch(endpoint, {
        method: "POST", cache: "no-store", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seenThrough: renderedVersion })
      });
      if (response.ok) {
        const result = await response.json();
        if (result.ok === true && result.seenThrough === renderedVersion) setAcknowledged(renderedVersion);
      } else if (response.status === 409) {
        router.refresh();
      }
    } catch {
      // Keep the dot on failure; reopening the item retries the acknowledgement.
    } finally { busy.current = false; }
  }, [endpoint, changedAt, unread, router]);
  return { unread, markSeen };
}
