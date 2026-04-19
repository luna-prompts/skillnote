'use client'
import type { InspectSkill } from '@/lib/api/imports'

type Conflict = 'rename' | 'skip' | 'replace'

type Props = {
  skills: InspectSkill[]
  selection: Set<string>
  onToggle: (name: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
  focused: string | null
  onFocus: (name: string) => void
  perSkillConflict?: Record<string, Conflict>
  onConflictChange?: (name: string, conflict: Conflict) => void
}

export function SkillSelectionList({
  skills, selection, onToggle, onSelectAll, onDeselectAll,
  focused, onFocus, perSkillConflict = {}, onConflictChange,
}: Props) {
  if (skills.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        No skills detected yet. The importer will still track this source; skills may appear after upstream changes.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/30 px-3 py-2 text-xs">
        <span>[{selection.size} / {skills.length}]</span>
        <div className="space-x-2">
          <button onClick={onSelectAll} className="hover:underline">Select all</button>
          <button onClick={onDeselectAll} className="hover:underline">Deselect all</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {skills.map(s => {
          const isFocused = focused === s.name
          const conflict = perSkillConflict[s.name] ?? 'rename'
          return (
            <div
              key={s.name}
              role="button"
              tabIndex={0}
              aria-pressed={isFocused}
              onClick={() => onFocus(s.name)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onFocus(s.name)
                }
              }}
              className={`flex items-start gap-2 border-b border-border/20 p-2 last:border-b-0 cursor-pointer ${
                isFocused ? 'bg-muted/60' : 'hover:bg-muted/30'
              }`}
            >
              <input
                type="checkbox"
                checked={selection.has(s.name)}
                onChange={() => onToggle(s.name)}
                onClick={e => e.stopPropagation()}
                aria-label={`Select ${s.name}`}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{s.name}</div>
                <div className="text-xs text-muted-foreground line-clamp-2">{s.description}</div>
              </div>
              {onConflictChange && (
                <select
                  value={conflict}
                  onChange={e => { e.stopPropagation(); onConflictChange(s.name, e.target.value as Conflict) }}
                  onClick={e => e.stopPropagation()}
                  className="text-[10px] h-6 rounded border border-border/60 bg-background px-1"
                  aria-label={`Conflict resolution for ${s.name}`}
                >
                  <option value="rename">Rename</option>
                  <option value="skip">Skip</option>
                  <option value="replace">Replace</option>
                </select>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
