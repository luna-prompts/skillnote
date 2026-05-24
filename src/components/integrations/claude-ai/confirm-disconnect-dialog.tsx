'use client'

import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'

interface Props {
  open: boolean
  browserLabel: string | null
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Linear/Notion-style confirmation dialog for destructive actions.
 *
 * - Focus-trapped so screen-reader users can't tab past it.
 * - Escape cancels.
 * - Confirm is destructive-tone (red) and is NOT the first focused element
 *   (prevents accidental Enter-press from disconnecting).
 */
export function ConfirmDisconnectDialog({ open, browserLabel, onCancel, onConfirm }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    // Focus the safe button (Cancel) on open so accidental Enter doesn't disconnect.
    cancelRef.current?.focus()

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="disconnect-dialog-title"
      aria-describedby="disconnect-dialog-body"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-150"
      onClick={onCancel}
    >
      <div
        className="bg-background border border-border rounded-xl shadow-2xl max-w-md w-full mx-4 p-5 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-red-500/10 p-2 shrink-0">
            <Trash2 className="h-4 w-4 text-red-500" />
          </div>
          <div className="flex-1">
            <h3
              id="disconnect-dialog-title"
              className="text-[15px] font-semibold text-foreground"
            >
              Disconnect {browserLabel ?? 'this browser'}?
            </h3>
            <p
              id="disconnect-dialog-body"
              className="mt-1 text-[13px] text-muted-foreground"
            >
              The extension token is revoked. Skills already synced to claude.ai
              stay there — disconnect doesn't sweep them. The user can re-pair
              this browser any time.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-[13px] rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-3 py-1.5 text-[13px] font-medium rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
          >
            Disconnect
          </button>
        </div>
      </div>
    </div>
  )
}
