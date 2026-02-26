'use client'

import { AlertCircle } from 'lucide-react'
import type { ValidationError } from '@/lib/skill-validation'

export function FieldError({ errors }: { errors: ValidationError[] }) {
  if (errors.length === 0) return null
  return (
    <div className="space-y-0.5">
      {errors.map((e, i) => (
        <p key={i} className="text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {e.message}
        </p>
      ))}
    </div>
  )
}
