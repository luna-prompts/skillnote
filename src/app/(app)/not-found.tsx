import Link from 'next/link'
import { FileQuestion } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
      <FileQuestion className="h-12 w-12 text-muted-foreground/40" />
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Page not found</h2>
        <p className="text-sm text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist or has been moved.</p>
      </div>
      <Link
        href="/"
        className="mt-2 px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
      >
        Go to Skills
      </Link>
    </div>
  )
}
