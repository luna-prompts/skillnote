'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { TopBar } from '@/components/layout/topbar'

// Browser-pairing approval moved OUT of a full-page interstitial and into the
// notifications bell (top-right). The extension's redemption link still lands
// here; we bounce into the app, where the bell auto-surfaces the pending
// pairing for one-click approval (with the code shown to verify against the
// extension). No more center-screen takeover.
export default function PairApprovalPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/')
  }, [router])
  return (
    <>
      <TopBar />
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="text-[13px] text-muted-foreground">
          Opening SkillNote… approve the pairing from the notifications bell in
          the top-right corner.
        </p>
      </div>
    </>
  )
}
