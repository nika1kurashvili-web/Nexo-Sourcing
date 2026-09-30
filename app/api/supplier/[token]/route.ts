import { supplierScope } from "@/lib/supplier-portal";
import { supplierDenied, supplierJson } from "@/lib/supplier-http";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try { await supplierScope((await params).token); return supplierJson({ active: true }); }
  catch { return supplierDenied(); }
}
