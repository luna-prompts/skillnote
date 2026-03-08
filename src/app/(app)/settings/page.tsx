'use client'

import { useEffect, useState, useCallback } from 'react'
import { ExternalLink, Info } from 'lucide-react'
import { toast } from 'sonner'
import { TopBar } from '@/components/layout/topbar'
import { fetchSettings, updateSettings } from '@/lib/api/settings'

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-muted-foreground/30'}`}
    >
      <span className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
    </button>
  )
}

function ConfirmDialog({ open, onConfirm, onCancel, title, message }: {
  open: boolean; onConfirm: () => void; onCancel: () => void; title: string; message: string
}) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="bg-background border border-border rounded-lg shadow-lg max-w-sm w-full mx-4 p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-[15px] font-semibold text-foreground mb-2">{title}</h3>
        <p className="text-[13px] text-muted-foreground mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-[13px] rounded-md border border-border text-foreground hover:bg-muted transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-[13px] rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors">
            Disable
          </button>
        </div>
      </div>
    </div>
  )
}

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0'

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)

  useEffect(() => {
    fetchSettings()
      .then(s => { setSettings(s); setLoaded(true) })
      .catch(() => { setLoaded(true) })
  }, [])

  const update = useCallback(async (key: string, value: boolean) => {
    const strVal = value ? 'true' : 'false'
    const patch: Record<string, string> = { [key]: strVal }

    // When disabling complete_skill, also disable outcome
    if (key === 'complete_skill_enabled' && !value) {
      patch['complete_skill_outcome_enabled'] = 'false'
    }

    setSettings(prev => ({ ...prev, ...patch }))
    try {
      await updateSettings(patch)
      toast.success('Setting updated — MCP clients will refresh automatically')
    } catch {
      // Revert all changes
      const revert: Record<string, string> = {}
      for (const k of Object.keys(patch)) {
        revert[k] = patch[k] === 'true' ? 'false' : 'true'
      }
      setSettings(prev => ({ ...prev, ...revert }))
      toast.error('Failed to update setting')
    }
  }, [])

  const handleCompleteSkillToggle = useCallback((value: boolean) => {
    if (!value) {
      setConfirmDisable(true)
    } else {
      update('complete_skill_enabled', true)
    }
  }, [update])

  const csEnabled = settings['complete_skill_enabled'] === 'true'
  const outcomeEnabled = settings['complete_skill_outcome_enabled'] === 'true'

  return (
    <>
      <TopBar showFab={false} />
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <h1 className="text-xl font-semibold text-foreground mb-8">Settings</h1>

          {/* MCP Tools */}
          {loaded && (
            <section className="mb-10">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">MCP Tools</h2>

              {/* Info box */}
              <div className="flex gap-3 p-3.5 rounded-lg bg-muted/50 border border-border mb-6">
                <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="space-y-2 text-[13px] text-muted-foreground">
                  <p>
                    The <span className="font-mono text-[12px] text-foreground">complete_skill</span> tool creates a feedback loop between AI agents and your skill library. When enabled, agents can rate skills (1-5) after applying them, helping you:
                  </p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Identify high-performing skills and double down on what works</li>
                    <li>Spot underperforming skills that need revision</li>
                    <li>Track adoption trends across agents and versions on the Analytics page</li>
                  </ul>
                  <p>Changes take effect immediately for all connected MCP clients.</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[14px] font-medium text-foreground">Skill Completion Tracking</p>
                    <p className="text-[13px] text-muted-foreground mt-0.5">
                      Include the <span className="font-mono text-[12px]">complete_skill</span> tool so agents can rate skills after use
                    </p>
                  </div>
                  <Toggle checked={csEnabled} onChange={handleCompleteSkillToggle} />
                </div>
                <div className={`flex items-start justify-between gap-4 pl-4 border-l-2 border-border transition-opacity ${!csEnabled ? 'opacity-40' : ''}`}>
                  <div>
                    <p className="text-[14px] font-medium text-foreground">Outcome Field</p>
                    <p className="text-[13px] text-muted-foreground mt-0.5">
                      Ask agents to describe what they accomplished — adds an <span className="font-mono text-[12px]">outcome</span> parameter to the tool
                    </p>
                  </div>
                  <Toggle checked={outcomeEnabled} onChange={v => update('complete_skill_outcome_enabled', v)} disabled={!csEnabled} />
                </div>
              </div>
            </section>
          )}

          {/* About */}
          <section className="mb-10">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">About</h2>
            <div className="space-y-1.5">
              <p className="text-[14px] font-semibold text-foreground">SkillNote <span className="text-[12px] font-normal text-muted-foreground ml-1">v{APP_VERSION}</span></p>
              <div className="flex items-center gap-4 pt-2">
                <a href="https://github.com/luna-prompts/skillnote" target="_blank" rel="noopener noreferrer" className="text-[13px] text-accent hover:underline inline-flex items-center gap-1">
                  View on GitHub <ExternalLink className="h-3 w-3" />
                </a>
                <a href="https://github.com/luna-prompts/skillnote#readme" target="_blank" rel="noopener noreferrer" className="text-[13px] text-accent hover:underline inline-flex items-center gap-1">
                  Documentation <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDisable}
        title="Disable Skill Completion Tracking?"
        message="This will remove the complete_skill tool from all connected MCP clients immediately. Agents will no longer be able to rate skills after use. You can re-enable it at any time."
        onConfirm={() => { setConfirmDisable(false); update('complete_skill_enabled', false) }}
        onCancel={() => setConfirmDisable(false)}
      />
    </>
  )
}
