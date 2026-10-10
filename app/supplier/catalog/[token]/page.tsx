import { INVALID_LINK } from "@/lib/supplier-portal";
import { readCatalog } from "@/lib/catalog-portal";
import { SupplierSession } from "@/components/SupplierSession";
import { SupplierCatalog } from "@/components/SupplierCatalog";
import { SupplierNav } from "@/components/SupplierNav";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SupplierCatalogPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let catalog;
  try { catalog = await readCatalog(token); }
  catch { return <p className="card">{INVALID_LINK}</p>; }
  return (
    <SupplierSession token={token} endpoint={`/api/supplier-catalog/${token}`}>
      <SupplierNav token={token} active="products" />
      <SupplierCatalog token={token} supplierName={catalog.supplierName} products={catalog.products} />
    </SupplierSession>
  );
}
