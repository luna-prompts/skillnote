import { notFound } from 'next/navigation'

// Catch-all route: any unmatched path triggers the (app) not-found page (with sidebar)
export default function CatchAll() {
  notFound()
}
