// Shown instantly while the next page is being prepared on the server, so a click on the menu
// gives immediate feedback instead of a frozen screen.
export default function Loading() {
  return (
    <div className="skeleton" role="status" aria-label="Loading">
      <div className="skeleton-bar title" />
      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div className="skeleton-bar short" />
        <div className="skeleton-bar block" />
        <div className="skeleton-bar" />
        <div className="skeleton-bar short" />
      </div>
    </div>
  );
}
