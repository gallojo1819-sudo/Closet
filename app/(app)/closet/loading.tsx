// Route-level loading UI for /closet — a skeleton catalog that mirrors the real
// grid's rhythm (4:5 frames, same gaps, quiet header), so the surface never
// flashes empty or shows a bare spinner while garments load.
export default function ClosetLoading() {
  const tiles = Array.from({ length: 8 });
  return (
    <div className="min-h-svh bg-cream font-ui text-neutral-900">
      <div className="mx-auto max-w-7xl px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:px-6">
        <div className="skeleton h-3 w-16 rounded-full" />
        <div className="skeleton mt-3 h-8 w-32 rounded-lg" />
      </div>

      {/* pill row placeholder */}
      <div className="mt-4 bg-cream/95">
        <div className="mx-auto flex max-w-7xl gap-2 px-4 py-3 sm:px-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton h-7 w-16 shrink-0 rounded-full" />
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-28 pt-2 sm:px-6">
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {tiles.map((_, i) => (
            <div key={i} className="flex flex-col">
              <div className="skeleton aspect-[4/5] w-full rounded-2xl" />
              <div className="skeleton mt-3 h-4 w-3/4 rounded" />
              <div className="skeleton mt-2 h-2.5 w-1/3 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
