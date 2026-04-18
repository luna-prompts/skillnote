'use client'
import { useState } from 'react'

type Mode = 'auto' | 'custom' | 'existing'

type Props = {
  value: string
  onChange: (value: string) => void
  suggested?: string
  existingCollections?: string[]
}

export function CollectionTargetPicker({ value, onChange, suggested, existingCollections = [] }: Props) {
  const [mode, setMode] = useState<Mode>('auto')

  function setAuto() {
    setMode('auto')
    if (suggested) onChange(suggested)
  }
  function setCustom() {
    setMode('custom')
  }
  function setExisting(slug: string) {
    setMode('existing')
    onChange(slug)
  }

  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={mode === 'auto'} onChange={setAuto} />
          Auto-create {suggested ? <code className="rounded bg-muted px-1 py-0.5">{suggested}</code> : ''}
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={mode === 'custom'} onChange={setCustom} />
          Custom name
        </label>
        {existingCollections.length > 0 && (
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={mode === 'existing'} onChange={() => setExisting(existingCollections[0])} />
            Add to existing
          </label>
        )}
      </div>
      {mode === 'custom' && (
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="my-collection"
          className="h-8 w-full rounded-md border border-border/60 bg-background px-2 text-xs"
        />
      )}
      {mode === 'existing' && (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="h-8 w-full rounded-md border border-border/60 bg-background px-2 text-xs"
        >
          {existingCollections.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      )}
      <p className="text-[11px] text-muted-foreground">You can move skills into other collections after import.</p>
    </div>
  )
}
