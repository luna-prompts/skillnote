'use client'

import { ExternalLink } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'

export default function SettingsPage() {
  return (
    <>
      <TopBar showFab={false} />
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <h1 className="text-xl font-semibold text-foreground mb-8">Settings</h1>

          {/* About */}
          <section className="mb-10">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">About</h2>
            <div className="space-y-1.5">
              <p className="text-[14px] font-semibold text-foreground">SkillNote <span className="text-[12px] font-normal text-muted-foreground ml-1">v0.1.0</span></p>
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
    </>
  )
}
