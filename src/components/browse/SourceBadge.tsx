export function SourceBadge({ sourceLabel }: { sourceLabel: string }) {
  return (
    <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      Imported · {sourceLabel}
    </span>
  )
}
