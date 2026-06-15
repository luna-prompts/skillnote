'use client'

import { Bell } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { ActivityFeed } from '@/components/integrations/claude-ai/activity-feed'

// Top-level Notifications destination (sidebar footer + the bell's "View all
// notifications"). A unified, recent-activity surface: skill changes, syncs,
// pairings, and conflicts all land here. Items have a 3-day life (enforced
// server-side), so this stays a "what happened lately" view, not an archive.
export default function NotificationsPage() {
  return (
    <>
      <TopBar />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          Notifications
        </h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          Recent activity across SkillNote — skill changes, syncs, pairings, and conflicts. Kept for 3 days.
        </p>

        <div className="mt-8">
          <ActivityFeed pageSize={100} />
        </div>
      </div>
    </>
  )
}
