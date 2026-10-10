import { INVALID_LINK } from "@/lib/supplier-portal";
import { readSupplierOrders } from "@/lib/catalog-portal";
import { SupplierSession } from "@/components/SupplierSession";
import { SupplierOrders } from "@/components/SupplierOrders";
import { SupplierNav } from "@/components/SupplierNav";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SupplierOrdersPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let data;
  try { data = await readSupplierOrders(token); }
  catch { return <p className="card">{INVALID_LINK}</p>; }
  return (
    <SupplierSession token={token} endpoint={`/api/supplier-catalog/${token}`}>
      <SupplierNav token={token} active="orders" />
      <SupplierOrders token={token} supplierName={data.supplierName} orders={data.orders} />
    </SupplierSession>
  );
}
