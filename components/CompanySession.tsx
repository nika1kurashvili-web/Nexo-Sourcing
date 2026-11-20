"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

// Hides the page when the company link was revoked (404). Network errors never destroy a half-filled order.
export function CompanySession({ token, children }: { token: string; children: ReactNode }) {
  const router = useRouter();
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let disposed = false;
    let checking = false;
    async function check() {
      if (checking) return;
      checking = true;
      try {
        const result = await fetch(`/api/company/${token}`, { cache: "no-store", referrerPolicy: "no-referrer" });
        if (!disposed) {
          if (result.status === 404) setUnavailable(true);
          else if (result.ok) { setUnavailable(false); router.refresh(); }
        }
      } catch { /* offline: keep the page */ }
      finally { checking = false; }
    }
    const interval = setInterval(() => void check(), 60000);
    window.addEventListener("focus", check);
    return () => { disposed = true; clearInterval(interval); window.removeEventListener("focus", check); };
  }, [token, router]);
  if (unavailable) return <p className="card">This link is invalid or no longer active.</p>;
  return <>{children}</>;
}
