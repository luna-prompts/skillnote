export function LocalOnlyChip() {
  return (
    <span
      className="rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
      title="This skill isn't included in the published marketplace (no upstream git source)."
    >
      ⊙ local only
    </span>
  )
}
