export default function Loading() {
  return (
    <main className="main" aria-busy="true" aria-label="Loading">
      <div className="page-header" />
      <div className="skeleton" style={{ minHeight: 200, borderRadius: 28 }} />
      <div className="skeleton" />
      <div className="skeleton" />
    </main>
  );
}
