'use client'
import { Compass } from 'lucide-react'

type Props = {
  onPasteUrl: () => void
}

export function BrowseEmptyState({ onPasteUrl }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <Compass className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold">Pull in skills from the community.</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Browse curated collections, or paste a GitHub URL to import your own.
      </p>
      <div className="mt-6 flex gap-3">
        <button disabled
          className="rounded-md border border-border/60 bg-card px-4 py-2 text-sm text-muted-foreground opacity-60"
          title="Coming soon">
          Browse library
        </button>
        <button onClick={onPasteUrl}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-foreground/90">
          Paste a URL
        </button>
      </div>
      <a className="mt-4 text-xs text-muted-foreground hover:underline" href="#">
        What are skills? →
      </a>
    </div>
  )
}
