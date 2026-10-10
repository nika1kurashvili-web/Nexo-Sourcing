import { requireSourcingAccess } from "@/lib/auth";
import { writeXlsx } from "@/lib/xlsx-lite";

export const dynamic = "force-dynamic";

// Staff-only empty template for "Upload order from Excel".
export async function GET() {
  await requireSourcingAccess();
  const file = writeXlsx([
    { name: "Order", rows: [["Barcode", "Quantity"], ["P00001", 100]], widths: [20, 12] },
    { name: "Help", rows: [
      ["Row 1 is the header. Then one product per row."],
      ["Barcode = the product Code (SKU) shown on the Products page. Quantity = pieces to order."],
      ["Delete the example row before uploading. The supplier and currency are chosen on the Orders page."]
    ], widths: [100] }
  ]);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="order-template.xlsx"',
      "Cache-Control": "private, no-store"
    }
  });
}
