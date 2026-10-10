"use client";

import { useRef, useState, type ReactNode } from "react";

// Search box above a table: hides the rows (tbody tr) whose text does not contain the typed words.
// Rows stay in the page, so a surrounding form still saves every line.
export function LineSearch({ children, placeholder = "Search by code or name" }: { children: ReactNode; placeholder?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<number | null>(null);

  function filter(value: string) {
    const words = value.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = Array.from(box.current?.querySelectorAll("tbody tr") ?? []) as HTMLElement[];
    let visible = 0;
    for (const row of rows) {
      const text = (row.textContent ?? "").toLowerCase();
      const match = words.every(word => text.includes(word));
      row.hidden = !match;
      if (match) visible++;
    }
    setShown(words.length ? visible : null);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 10px" }}>
        <input type="search" placeholder={placeholder} aria-label="Search products" style={{ maxWidth: 340 }}
          onChange={event => filter(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} />
        {shown !== null && <span className="small muted">{shown === 0 ? "No match" : `${shown} found`}</span>}
      </div>
      <div ref={box}>{children}</div>
    </div>
  );
}
