"use client";

import { useEffect, useState } from "react";

type Props = {
  createdAt?: string | null;
  deadlineAt?: string | null;
};

function formatLocalDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateKey(date: Date) {
  return Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );
}

function deadlineState(value: string) {
  const now = new Date();
  const deadline = new Date(value);

  const difference =
    (dateKey(deadline) - dateKey(now)) / 86400000;

  if (difference < 0) {
    const days = Math.abs(difference);
    return `Overdue by ${days} day${days === 1 ? "" : "s"}`;
  }

  if (difference === 0) return "Due today";
  if (difference === 1) return "Due tomorrow";

  return `${difference} days left`;
}

export function SupplierRequestDates({
  createdAt,
  deadlineAt,
}: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const timezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";

  return (
    <div
      style={{
        marginTop: 12,
        display: "grid",
        gap: 5,
      }}
    >
      {createdAt && (
  <div>
    <strong>Created:</strong>{" "}
    {formatLocalDate(createdAt)}
  </div>
)}

      {deadlineAt && (
        <div>
          <strong>Deadline:</strong>{" "}
          {formatLocalDate(deadlineAt)}
          {" · "}
          <strong>{deadlineState(deadlineAt)}</strong>
        </div>
      )}

      <div className="small muted">
        Your local time · {timezone}
      </div>
    </div>
  );
}
