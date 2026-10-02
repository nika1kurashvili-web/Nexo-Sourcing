"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export function SupplierSession({ token, children }: { token: string; children: ReactNode }) {
  const router = useRouter();
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let disposed = false;
    let checking = false;
    async function check() {
      if (checking) return;
      checking = true;
      try {
        const result = await fetch(`/api/supplier/${token}`, { cache: "no-store", referrerPolicy: "no-referrer" });
        if (!disposed) {
          // Only an explicit "link invalid" answer (404) hides the page. Network
          // errors and temporary server errors must not destroy a half-filled form.
          if (result.status === 404) setUnavailable(true);
          else if (result.ok) { setUnavailable(false); router.refresh(); }
        }
      } catch { /* offline or temporary failure: keep the form, retry on next check */ }
      finally { checking = false; }
    }
    const interval = setInterval(() => void check(), 30000);
    window.addEventListener("focus", check);
    return () => { disposed = true; clearInterval(interval); window.removeEventListener("focus", check); };
  }, [token, router]);
  if (unavailable) return <p className="card">This supplier link is invalid or no longer active.</p>;
  return <>{children}</>;
}
