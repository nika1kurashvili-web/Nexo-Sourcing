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
          setUnavailable(!result.ok);
          if (result.ok) router.refresh();
        }
      } catch { if (!disposed) setUnavailable(true); }
      finally { checking = false; }
    }
    const interval = setInterval(() => void check(), 30000);
    window.addEventListener("focus", check);
    return () => { disposed = true; clearInterval(interval); window.removeEventListener("focus", check); };
  }, [token, router]);
  if (unavailable) return <p className="card">This supplier link is unavailable. Please refresh the page or contact Nexo.</p>;
  return <>{children}</>;
}
