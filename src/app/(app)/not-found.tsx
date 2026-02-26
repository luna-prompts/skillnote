'use client'
import Link from 'next/link'
import { TopBar } from '@/components/layout/topbar'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <>
      <TopBar showFab={false} />
      <main className="flex-1 flex flex-col items-center justify-center py-24 px-6">
        <div className="w-14 h-14 rounded-2xl bg-muted/80 flex items-center justify-center mb-5">
          <FileQuestion className="h-7 w-7 text-muted-foreground/60" />
        </div>
        <h1 className="text-[18px] font-semibold text-foreground mb-2">Page not found</h1>
        <p className="text-[13px] text-muted-foreground text-center max-w-xs mb-6">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Button asChild size="sm" className="h-8 text-[13px] bg-foreground text-background hover:bg-foreground/90">
          <Link href="/">Go to Skills</Link>
        </Button>
      </main>
    </>
  )
}
