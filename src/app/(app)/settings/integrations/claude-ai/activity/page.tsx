'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar } from '@/components/layout/topbar'

// Activity was renamed to Notifications and moved to the top-level
// /notifications route (sidebar footer + the bell). This deep settings path
// now just redirects there so any existing links keep working.
export default function ClaudeAIActivityRedirect() {
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
