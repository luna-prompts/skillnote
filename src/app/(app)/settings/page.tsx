'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTheme } from 'next-themes'
import { Upload, Download, RotateCcw, ExternalLink, Sun, Moon, Monitor } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { ImportModal } from '@/components/import/ImportModal'
import { exportAllAsZip } from '@/lib/export-utils'
import { mockSkills } from '@/lib/mock-data'
import { toast } from 'sonner'

const ACCENT_COLORS = [
  { name: 'Teal', value: '#0d9488' },
  { name: 'Purple', value: '#7c3aed' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Orange', value: '#ea580c' },
  { name: 'Pink', value: '#db2777' },
]

const EDITOR_MODES = ['Rendered', 'Raw', 'Split'] as const
const FONT_SIZES = [
  { label: 'Small', value: '13px' },
  { label: 'Medium', value: '15px' },
  { label: 'Large', value: '17px' },
] as const

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">{title}</h2>
      <div className="bg-card border border-border/60 rounded-xl divide-y divide-border/60">
        {children}
      </div>
    </section>
  )
}

function Row({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 gap-4">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-foreground">{label}</p>
        <p className="text-[12px] text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const options = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'dark', icon: Moon, label: 'Dark' },
    { value: 'system', icon: Monitor, label: 'System' },
  ] as const

  if (!mounted) return <div className="h-8 w-[200px] bg-muted rounded-lg animate-pulse" />

  return (
    <div className="flex items-center bg-muted rounded-lg p-0.5 gap-0.5">
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${
            theme === value
              ? 'bg-card shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  )
}

function AccentPicker() {
  const [accent, setAccent] = useState('#0d9488')

  useEffect(() => {
    const saved = localStorage.getItem('skillnote:accent')
    if (saved) {
      setAccent(saved)
      applyAccent(saved)
    }
  }, [])

  function applyAccent(color: string) {
    document.documentElement.style.setProperty('--accent', color)
    document.documentElement.style.setProperty('--ring', color)
  }

  function handleSelect(color: string) {
    setAccent(color)
    localStorage.setItem('skillnote:accent', color)
    applyAccent(color)
  }

  return (
    <div className="flex items-center gap-2">
      {ACCENT_COLORS.map(({ name, value }) => (
        <button
          key={value}
          onClick={() => handleSelect(value)}
          className={`w-6 h-6 rounded-full transition-all ${
            accent === value ? 'ring-2 ring-offset-2 ring-offset-card' : 'hover:scale-110'
          }`}
          style={{
            backgroundColor: value,
            ...(accent === value ? { boxShadow: `0 0 0 2px var(--card), 0 0 0 4px ${value}` } : {}),
          }}
          title={name}
          aria-label={`${name} accent color`}
        />
      ))}
    </div>
  )
}

function SelectControl({ storageKey, options, defaultValue }: {
  storageKey: string
  options: readonly { label: string; value: string }[]
  defaultValue: string
}) {
  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    const saved = localStorage.getItem(storageKey)
    if (saved) setValue(saved)
  }, [storageKey])

  function handleChange(newValue: string) {
    setValue(newValue)
    localStorage.setItem(storageKey, newValue)
  }

  return (
    <select
      value={value}
      onChange={e => handleChange(e.target.value)}
      className="h-8 px-3 pr-8 text-[13px] bg-muted border border-border/60 rounded-lg text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237a7a8a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}

function SwitchControl({ storageKey, defaultValue = false }: { storageKey: string; defaultValue?: boolean }) {
  const [checked, setChecked] = useState(defaultValue)

  useEffect(() => {
    const saved = localStorage.getItem(storageKey)
    if (saved !== null) setChecked(saved === 'true')
  }, [storageKey])

  function toggle() {
    const next = !checked
    setChecked(next)
    localStorage.setItem(storageKey, String(next))
  }

  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={toggle}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-muted-foreground/30'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export default function SettingsPage() {
  const [importOpen, setImportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const handleExportAll = useCallback(async () => {
    setExporting(true)
    try {
      const filename = await exportAllAsZip()
      toast.success(`Exported ${filename}`)
    } catch {
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }, [])

  const handleReset = useCallback(() => {
    if (window.confirm('Reset all local preferences and reload? This cannot be undone.')) {
      localStorage.clear()
      window.location.reload()
    }
  }, [])

  return (
    <>
      <TopBar showFab={false} />
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <h1 className="text-xl font-semibold text-foreground mb-8">Settings</h1>

          {/* Appearance */}
          <Section title="Appearance">
            <Row label="Theme" desc="Choose light, dark, or follow system">
              <ThemeToggle />
            </Row>
            <Row label="Accent Color" desc="Primary action color throughout the app">
              <AccentPicker />
            </Row>
          </Section>

          {/* Editor */}
          <Section title="Editor">
            <Row label="Default Mode" desc="Starting mode when you open the editor">
              <SelectControl
                storageKey="skillnote:editor-mode"
                options={EDITOR_MODES.map(m => ({ label: m, value: m.toLowerCase() }))}
                defaultValue="rendered"
              />
            </Row>
            <Row label="Editor Font Size" desc="Text size inside the editor">
              <SelectControl
                storageKey="skillnote:editor-font-size"
                options={FONT_SIZES.map(f => ({ label: f.label, value: f.value }))}
                defaultValue="15px"
              />
            </Row>
            <Row label="Spell Check" desc="Underline spelling errors in the editor">
              <SwitchControl storageKey="skillnote:spell-check" defaultValue={false} />
            </Row>
          </Section>

          {/* Data */}
          <Section title="Data">
            <Row label="Import Skills" desc="Import .md files or a .zip archive">
              <button
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium bg-muted hover:bg-muted-foreground/15 border border-border/60 rounded-lg text-foreground transition-colors"
              >
                <Upload className="h-3.5 w-3.5" />
                Import
              </button>
            </Row>
            <Row label="Export All Skills" desc={`Download all ${mockSkills.length} skills as a ZIP archive`}>
              <button
                onClick={handleExportAll}
                disabled={exporting}
                className="flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium bg-muted hover:bg-muted-foreground/15 border border-border/60 rounded-lg text-foreground transition-colors disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {exporting ? 'Exporting...' : `Export ${mockSkills.length} Skills`}
              </button>
            </Row>
            <Row label="Reset to Defaults" desc="Clears all local preferences and reloads">
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 h-8 px-3 text-[13px] font-medium text-destructive border border-destructive/30 rounded-lg hover:bg-destructive/10 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            </Row>
          </Section>

          {/* About */}
          <section className="mb-10">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">About</h2>
            <div className="space-y-1.5">
              <p className="text-[14px] font-semibold text-foreground">SkillNote <span className="text-[12px] font-normal text-muted-foreground ml-1">v0.1.0</span></p>
              <p className="text-[13px] text-muted-foreground">Open-source self-hostable Skill CMS</p>
              <p className="text-[12px] text-muted-foreground">Built with Next.js, Tiptap, Tailwind CSS</p>
              <div className="flex items-center gap-4 pt-2">
                <a href="#" className="text-[13px] text-accent hover:underline inline-flex items-center gap-1">
                  View on GitHub <ExternalLink className="h-3 w-3" />
                </a>
                <a href="#" className="text-[13px] text-accent hover:underline inline-flex items-center gap-1">
                  Documentation <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </section>
        </div>
      </div>

      {importOpen && (
        <ImportModal onClose={() => setImportOpen(false)} />
      )}
    </>
  )
}
