"use client";

import { useEffect, useRef, useState } from "react";
import { ProductEditor } from "@/components/ProductEditor";

// "Edit" opens the product form in a window on top of the page (instead of unfolding inside the card).
export function ProductEditModal({ product, photoCount }: { product: Record<string, any>; photoCount: number }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);

  return (
    <>
      <button type="button" className="btn secondary" onClick={() => setOpen(true)}>Edit</button>
      {open && (
        <dialog ref={dialog} className="edit-dialog" onClose={() => setOpen(false)}
          onClick={event => { if (event.target === dialog.current) dialog.current?.close(); }}>
          <div className="edit-dialog-head">
            <strong>{product.name}</strong>
            <button type="button" className="btn secondary sm" onClick={() => dialog.current?.close()}>✕ Close</button>
          </div>
          <div className="edit-dialog-body">
            <ProductEditor mode="edit" product={product} photoCount={photoCount} onSaved={() => dialog.current?.close()} />
          </div>
        </dialog>
      )}
    </>
  );
}
