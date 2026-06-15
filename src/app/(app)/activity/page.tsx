'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar } from '@/components/layout/topbar'

// "Activity" was renamed to "Notifications" and moved to /notifications.
// This route just redirects so any existing links/bookmarks keep working.
export default function ActivityRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/notifications')
  }, [router])
  return (
    <>
      <TopBar />
      <div className="mx-auto max-w-3xl px-6 py-10 text-[13px] text-muted-foreground">
        Opening Notifications…
      </div>
    </>
  )
}
