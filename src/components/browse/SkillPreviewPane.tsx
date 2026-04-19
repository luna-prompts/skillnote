'use client'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { InspectSkill } from '@/lib/api/imports'

type Props = {
  skill: InspectSkill | null
}

export function SkillPreviewPane({ skill }: Props) {
  if (!skill) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Click a skill on the left to preview it.
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-6 space-y-3">
      <header>
        <h4 className="text-sm font-semibold">{skill.name}</h4>
        {skill.path && (
          <p className="mt-0.5 text-[11px] font-mono text-muted-foreground">{skill.path}</p>
        )}
      </header>
      {skill.description && (
        <div className="rounded-md border border-border/40 bg-muted/20 p-3 text-sm">
          {skill.description}
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">
        {skill.license && <div>License: {skill.license}</div>}
        {skill.content_hash && <div>SHA: <code className="font-mono">{skill.content_hash.slice(0, 12)}</code></div>}
      </div>
      {skill.body ? (
        <div className="rounded-md border border-border/40 bg-card p-4">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{skill.body}</ReactMarkdown>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border/40 p-4 text-xs text-muted-foreground">
          No SKILL.md body available for preview.
        </div>
      )}
    </div>
  )
}
