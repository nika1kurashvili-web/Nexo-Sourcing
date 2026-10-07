import { CURRENCIES } from "@/lib/catalog-validation";

// Shared product fields for the Nexo editor and the supplier request form.
export function ProductFieldInputs({ values = {}, staff = false }: { values?: Record<string, any>; staff?: boolean }) {
  const v = (key: string) => values[key] ?? "";
  const number = (name: string, label: string, step = "any") => (
    <label>{label}<input name={name} type="number" min="0" max="9999999" step={step} defaultValue={v(name)} /></label>
  );
  return (
    <>
      <label>Product Name *<input name="name" required maxLength={200} defaultValue={v("name")} /></label>
      <label>Description<textarea name="description" maxLength={5000} defaultValue={v("description")} /></label>
      <label>Specifications<textarea name="specifications" maxLength={5000} defaultValue={v("specifications")} /></label>
      <div className="form-grid four">
        {number("price", "Price")}
        <label>Currency<select name="currency" defaultValue={v("currency") || "USD"}>
          {CURRENCIES.map(currency => <option key={currency} value={currency}>{currency}</option>)}
        </select></label>
        {number("moq", "MOQ")}
        {number("lead_time_days", "Lead Time (days)", "1")}
      </div>
      <div className="form-grid four">
        {number("box_length_cm", "Box Length (cm)")}
        {number("box_width_cm", "Box Width (cm)")}
        {number("box_height_cm", "Box Height (cm)")}
        {number("weight_kg", "Weight (kg)")}
      </div>
      {staff && <label>Internal Note (only visible to Nexo)<textarea name="internal_note" maxLength={5000} defaultValue={v("internal_note")} /></label>}
    </>
  );
}
