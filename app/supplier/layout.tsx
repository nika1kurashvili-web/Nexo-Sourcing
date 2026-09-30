import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Supplier Portal | Nexo Sourcing",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer"
};
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  return <main className="supplier-portal"><h1>Nexo Sourcing</h1>{children}</main>;
}
