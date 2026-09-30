<<<<<<< HEAD
"use client";

import { useEffect, useState } from "react";

type Props = {
  createdAt: string;
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
      <div>
        <strong>Created:</strong>{" "}
        {formatLocalDate(createdAt)}
      </div>

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
=======
"use client";

import { useEffect, useState } from "react";

type Props = {
  createdAt: string;
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

function localDateKey(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
}

function getDeadlineLabel(deadline: string) {
  const now = new Date();
  const due = new Date(deadline);

  const today = localDateKey(now);
  const dueDay = localDateKey(due);

  const days = Math.round((dueDay - today) / 86400000);

  if (days < 0) {
    const count = Math.abs(days);
    return `Overdue by ${count} day${count === 1 ? "" : "s"}`;
  }

  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";

  return `${days} days left`;
}

export default function SupplierRequestDates({
  createdAt,
  deadlineAt,
}: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="supplier-request-dates">
        <div>Created: —</div>
        {deadlineAt && <div>Deadline: —</div>}
      </div>
    );
  }

  const timezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";

  return (
    <div className="supplier-request-dates">
      <div>
        <strong>Created:</strong> {formatLocalDate(createdAt)}
      </div>

      {deadlineAt && (
        <div>
          <strong>Deadline:</strong> {formatLocalDate(deadlineAt)}
          <span style={{ marginLeft: 8, fontWeight: 600 }}>
            · {getDeadlineLabel(deadlineAt)}
          </span>
        </div>
      )}

      <div
        style={{
          marginTop: 4,
          fontSize: 12,
          opacity: 0.65,
        }}
      >
        Your local time · {timezone}
      </div>
    </div>
  );
}
>>>>>>> c22cbcdda9fba440b968329c4da0ee7d388d0cf9
>>>>>>> fbb90203b53c5af563c8b3c6ad0ab8e87fbff2c3
