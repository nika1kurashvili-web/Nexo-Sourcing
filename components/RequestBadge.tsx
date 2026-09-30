import { requestStatusLabel } from "@/lib/labels";
export function RequestBadge({ status }: { status: string }) {
  let cls = "badge";
  if (["approved","response_received"].includes(status)) cls += " success";
  if (["waiting_supplier","partial_response","waiting_client"].includes(status)) cls += " warning";
  if (["rejected","cancelled"].includes(status)) cls += " danger";
  return <span className={cls}>{requestStatusLabel(status)}</span>;
}
