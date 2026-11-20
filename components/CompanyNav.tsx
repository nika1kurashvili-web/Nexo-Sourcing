import Link from "next/link";

export function CompanyNav({ token, active, companyName }: { token: string; active: "products" | "orders" | "propose"; companyName: string }) {
  return (
    <>
      <div className="muted" style={{ marginBottom: 8 }}>{companyName}</div>
      <nav className="badges" style={{ marginBottom: 16 }} aria-label="Company portal">
        <Link className={active === "products" ? "btn" : "btn secondary"} href={`/company/${token}`}>Products</Link>
        <Link className={active === "orders" ? "btn" : "btn secondary"} href={`/company/${token}/orders`}>My orders</Link>
        <Link className={active === "propose" ? "btn" : "btn secondary"} href={`/company/${token}/propose`}>Suggest a product</Link>
      </nav>
    </>
  );
}
