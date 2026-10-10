import Link from "next/link";

export function SupplierNav({ token, active }: { token: string; active: "products" | "orders" }) {
  return (
    <nav className="badges" style={{ marginBottom: 16 }} aria-label="Supplier portal">
      <Link className={active === "products" ? "btn" : "btn secondary"} href={`/supplier/catalog/${token}`}>Products</Link>
      <Link className={active === "orders" ? "btn" : "btn secondary"} href={`/supplier/catalog/${token}/orders`}>Orders</Link>
    </nav>
  );
}
