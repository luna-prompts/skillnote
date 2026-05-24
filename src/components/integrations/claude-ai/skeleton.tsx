// Skeleton loaders for the claude.ai integration pages.
// Keeps the page layout stable while data loads — no janky reflow when
// the real content swaps in.

export function IntegrationCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 rounded-full bg-muted animate-pulse" />
          <div>
            <div className="h-3.5 w-40 rounded bg-muted animate-pulse" />
            <div className="mt-1.5 h-2.5 w-32 rounded bg-muted/60 animate-pulse" />
          </div>
        </div>
        <div className="h-6 w-20 rounded bg-muted animate-pulse" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-md bg-muted/30 px-3 py-2">
            <div className="h-4 w-10 rounded bg-muted animate-pulse" />
            <div className="mt-1.5 h-2.5 w-16 rounded bg-muted/60 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function HealthCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="h-4 w-32 rounded bg-muted animate-pulse" />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <div className="h-5 w-12 rounded bg-muted animate-pulse" />
            <div className="mt-1.5 h-2.5 w-20 rounded bg-muted/60 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ActivityRowSkeleton() {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-muted animate-pulse" />
      <div className="flex-1">
        <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
        <div className="mt-1.5 h-2.5 w-24 rounded bg-muted/60 animate-pulse" />
      </div>
    </div>
  )
}
