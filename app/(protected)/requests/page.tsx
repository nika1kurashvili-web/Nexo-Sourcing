import { redirect } from "next/navigation";

// The Requests feature was retired. Old links go to Orders.
export default function RequestsPage() {
  redirect("/orders");
}
