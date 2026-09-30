export const requestStatuses = [
  ["new", "New"],
  ["sent_to_china", "Sent to China"],
  ["waiting_supplier", "Waiting for Supplier"],
  ["partial_response", "Partial Response"],
  ["response_received", "Response Received"],
  ["quote_sent", "Quote Sent"],
  ["waiting_client", "Waiting for Client"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["cancelled", "Cancelled"]
] as const;

export const supplierStatuses = [
  ["not_sent", "Not Sent"],
  ["sent", "Sent"],
  ["waiting", "Waiting for Supplier"],
  ["answered", "Response Received"],
  ["not_found", "Not Found"]
] as const;

export function requestStatusLabel(value: string) {
  return requestStatuses.find(([key]) => key === value)?.[1] ?? value;
}
export function supplierStatusLabel(value: string) {
  return supplierStatuses.find(([key]) => key === value)?.[1] ?? value;
}

const activityLabels: Record<string, string> = {
  request_created: "Request Created",
  request_status_changed: "Request Status Changed",
  item_created: "Item Added",
  item_updated: "Item Updated",
  item_deleted: "Item Deleted",
  item_image_uploaded: "Item Image Uploaded"
};

export function activityLabel(value: string) {
  return activityLabels[value] ?? value.replaceAll("_", " ");
}
