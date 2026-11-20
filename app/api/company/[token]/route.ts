import { companyScope } from "@/lib/company-portal";
import { supplierDenied, supplierJson } from "@/lib/supplier-http";

export const dynamic = "force-dynamic";

// Used by the portal pages to notice a revoked link (404) without reloading.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try { await companyScope((await params).token); return supplierJson({ active: true }); }
  catch { return supplierDenied(); }
}
