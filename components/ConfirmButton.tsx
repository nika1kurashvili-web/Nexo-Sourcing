"use client";

import type { ReactNode } from "react";

// Submit button that asks for confirmation first (used for permanent deletions).
export function ConfirmButton({ message, className, children }: { message: string; className?: string; children: ReactNode }) {
  return (
    <button type="submit" className={className} onClick={event => { if (!confirm(message)) event.preventDefault(); }}>
      {children}
    </button>
  );
}
