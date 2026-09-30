"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";

const UploadContext = createContext({ setUploading: (_value: boolean) => {} });
export const useItemUpload = () => useContext(UploadContext);

export function RequestItemForm({ action, children }: {
  action: (data: FormData) => Promise<{ error: string } | void>;
  children: ReactNode;
}) {
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);

  return (
    <UploadContext.Provider value={{ setUploading }}>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (uploading || busy.current) return;
        const data = new FormData(event.currentTarget);
        busy.current = true;
        setSaving(true);
        setError("");
        try {
          const result = await action(data);
          if (result?.error) setError(result.error);
        } catch {
          setError("Unable to save. Please try again.");
        } finally {
          busy.current = false;
          setSaving(false);
        }
      }}>
        <fieldset disabled={saving} className="form-grid" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {children}
        </fieldset>
        {uploading && <p role="status">Please wait for the image upload to finish.</p>}
        {saving && <p role="status">Saving...</p>}
        {error && <p role="alert" className="notice">{error}</p>}
      </form>
    </UploadContext.Provider>
  );
}
