import { redirect } from "next/navigation";

// The old dashboard only showed Requests, which were retired. Orders is the home page now.
export default function DashboardPage() {
  redirect("/orders");
}
