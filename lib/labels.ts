export const requestStatuses = [
  ["new", "ახალი"],
  ["sent_to_china", "გაგზავნილია ჩინეთში"],
  ["waiting_supplier", "ჩინეთის პასუხს ველოდებით"],
  ["partial_response", "ნაწილობრივი პასუხი"],
  ["response_received", "პასუხი მიღებულია"],
  ["quote_sent", "შეთავაზება გაგზავნილია"],
  ["waiting_client", "კლიენტის პასუხს ველოდებით"],
  ["approved", "დადასტურებული"],
  ["rejected", "უარყოფილი"],
  ["cancelled", "გაუქმებული"]
] as const;

export const supplierStatuses = [
  ["not_sent", "ჯერ არ გაგზავნილა"],
  ["sent", "გაგზავნილია"],
  ["waiting", "პასუხს ველოდებით"],
  ["answered", "პასუხი მიღებულია"],
  ["not_found", "ვერ მოიძებნა"]
] as const;

export function requestStatusLabel(value: string) {
  return requestStatuses.find(([key]) => key === value)?.[1] ?? value;
}
export function supplierStatusLabel(value: string) {
  return supplierStatuses.find(([key]) => key === value)?.[1] ?? value;
}
