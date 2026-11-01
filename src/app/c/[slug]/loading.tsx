export default function Loading() {
  return (
    <div className="grid animate-pulse gap-5">
      <div className="h-8 w-48 rounded bg-surface-2" />
      <div className="h-16 rounded-lg bg-surface" />
      <div className="h-9 w-96 rounded bg-surface-2" />
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-40 rounded-lg bg-surface" />
        <div className="h-40 rounded-lg bg-surface" />
        <div className="h-40 rounded-lg bg-surface" />
        <div className="h-40 rounded-lg bg-surface" />
      </div>
    </div>
  );
}
