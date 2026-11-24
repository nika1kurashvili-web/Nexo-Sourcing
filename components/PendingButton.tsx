"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

// Submit button that shows "Working…" and ignores extra clicks while the server action runs.
export function PendingButton({ className, children, pendingText = "Working…" }: { className?: string; children: ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={pending} aria-busy={pending}>{pending ? pendingText : children}</button>;
}
