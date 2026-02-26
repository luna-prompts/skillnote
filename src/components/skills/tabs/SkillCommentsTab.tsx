'use client'
import { useState, useRef } from 'react'
import { MessageSquare, MoreHorizontal, Pencil, Reply, Send, Trash2, Loader2 } from 'lucide-react'
import { updateCommentApi, deleteCommentApi } from '@/lib/api/skills'
import { Button } from '@/components/ui/button'
import { type Comment, mockTeamMembers } from '@/lib/mock-data'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const EMOJI_MAP: Record<string, string> = {
  '+1': '👍', 'heart': '❤️', 'rocket': '🚀', 'fire': '🔥', 'tada': '🎉',
}

function CommentInput({ placeholder, onSubmit, onSubmitComment, autoFocus }: { placeholder: string; onSubmit?: () => void; onSubmitComment?: (body: string) => Promise<void>; autoFocus?: boolean }) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [emojiFilter, setEmojiFilter] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setValue(val)
    const cursor = e.target.selectionStart
    const textBefore = val.slice(0, cursor)
    const atMatch = /@(\w*)$/.exec(textBefore)
    const emojiMatch = /:(\w*)$/.exec(textBefore)
    setMentionOpen(!!atMatch)
    if (emojiMatch && emojiMatch[1].length > 0) {
      setEmojiOpen(true)
      setEmojiFilter(emojiMatch[1])
    } else {
      setEmojiOpen(false)
      setEmojiFilter('')
    }
  }

  const insertMention = (name: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const cursor = ta.selectionStart
    const textBefore = value.slice(0, cursor)
    const atIdx = textBefore.lastIndexOf('@')
    const newValue = value.slice(0, atIdx) + `@${name} ` + value.slice(cursor)
    setValue(newValue)
    setMentionOpen(false)
    setTimeout(() => { ta.focus(); ta.setSelectionRange(atIdx + name.length + 2, atIdx + name.length + 2) }, 0)
  }

  const insertEmoji = (_key: string, emoji: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const cursor = ta.selectionStart
    const textBefore = value.slice(0, cursor)
    const colonIdx = textBefore.lastIndexOf(':')
    const newValue = value.slice(0, colonIdx) + emoji + ' ' + value.slice(cursor)
    setValue(newValue)
    setEmojiOpen(false)
    setTimeout(() => { ta.focus(); ta.setSelectionRange(colonIdx + emoji.length + 1, colonIdx + emoji.length + 1) }, 0)
  }

  const filteredEmojis = Object.entries(EMOJI_MAP).filter(([k]) => k.startsWith(emojiFilter))

  return (
    <div className="border border-border/60 rounded-xl overflow-hidden bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent transition-all relative">
      <div className="flex border-b border-border/40">
        <button
          onClick={() => setShowPreview(false)}
          className={cn('px-3 py-1.5 text-[11px] font-medium transition-colors min-h-[44px] sm:min-h-0', !showPreview ? 'text-accent border-b-2 border-accent' : 'text-muted-foreground')}
        >Write</button>
        <button
          onClick={() => setShowPreview(true)}
          className={cn('px-3 py-1.5 text-[11px] font-medium transition-colors min-h-[44px] sm:min-h-0', showPreview ? 'text-accent border-b-2 border-accent' : 'text-muted-foreground')}
        >Preview</button>
      </div>
      {showPreview ? (
        <div className="p-4 min-h-[100px] prose prose-sm dark:prose-invert max-w-none text-[13px]">
          {value ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown> : <p className="text-muted-foreground">Nothing to preview</p>}
        </div>
      ) : (
        <div className="relative">
          <textarea
            ref={textareaRef}
            className="w-full p-4 text-sm bg-transparent resize-none focus:outline-none min-h-[100px] focus:min-h-[200px] sm:focus:min-h-[100px] placeholder:text-muted-foreground transition-all"
            placeholder={placeholder}
            value={value}
            onChange={handleChange}
            autoFocus={autoFocus}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                if (!value.trim() || submitting) return
                if (onSubmitComment) {
                  setSubmitting(true)
                  try {
                    await onSubmitComment(value)
                    setValue('')
                  } finally {
                    setSubmitting(false)
                  }
                } else {
                  onSubmit?.()
                }
              }
            }}
          />
          {/* @mention dropdown — above input on mobile, below on desktop */}
          {mentionOpen && (
            <div className="absolute left-4 bottom-full sm:bottom-2 mb-1 sm:mb-0 z-20 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
              {mockTeamMembers.map(m => (
                <button key={m.name} onClick={() => insertMention(m.name)} className="flex items-center gap-2 px-3 py-2 min-h-[44px] sm:min-h-0 text-[13px] hover:bg-muted w-full text-left">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: m.color }}>{m.name[0]}</div>
                  {m.name}
                </button>
              ))}
            </div>
          )}
          {/* Emoji dropdown — above input on mobile, below on desktop */}
          {emojiOpen && filteredEmojis.length > 0 && (
            <div className="absolute left-4 bottom-full sm:bottom-2 mb-1 sm:mb-0 z-20 bg-popover border border-border rounded-lg shadow-lg overflow-hidden">
              {filteredEmojis.map(([key, emoji]) => (
                <button key={key} onClick={() => insertEmoji(key, emoji)} className="flex items-center gap-2 px-3 py-2 min-h-[44px] sm:min-h-0 text-[13px] hover:bg-muted w-full text-left">
                  <span>{emoji}</span>
                  <span className="text-muted-foreground">:{key}:</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="px-4 py-3 border-t border-border/60 bg-muted/30 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground hidden sm:inline">
          <kbd className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">Ctrl+Enter</kbd> to submit · <kbd className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">@</kbd> mention · <kbd className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">:</kbd> emoji
        </span>
        <span className="text-[11px] text-muted-foreground sm:hidden">
          <kbd className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">@</kbd> mention · <kbd className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">:</kbd> emoji
        </span>
        <Button
          size="sm"
          className="h-8 min-h-[44px] sm:min-h-0 text-[13px] gap-1.5"
          aria-label="Submit comment"
          disabled={submitting || !value.trim()}
          onClick={async () => {
            if (!value.trim()) return
            setSubmitting(true)
            try {
              await onSubmitComment?.(value)
              setValue('')
            } finally {
              setSubmitting(false)
            }
          }}
        >
          {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          Comment
        </Button>
      </div>
    </div>
  )
}

function CommentCard({ comment, skillSlug, onDeleted }: { comment: Comment; skillSlug?: string; onDeleted?: () => void }) {
  const [showReply, setShowReply] = useState(false)
  const [reactions, setReactions] = useState(comment.reactions)
  const [showMenu, setShowMenu] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(comment.body)
  const [editSaving, setEditSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const initials = comment.author.split(' ').map(n => n[0]).join('')
  const timeAgo = formatRelative(comment.created_at)
  const absoluteTime = new Date(comment.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

  const toggleReaction = (emoji: string) => {
    setReactions(prev => prev.map(r => r.emoji === emoji ? { ...r, count: r.count + 1 } : r))
  }

  const handleEditSave = async () => {
    if (!editValue.trim() || !skillSlug) { setIsEditing(false); return }
    setEditSaving(true)
    try {
      await updateCommentApi(skillSlug, comment.id, editValue)
      comment.body = editValue
      setIsEditing(false)
    } catch {
      // keep editing open on error
    } finally {
      setEditSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!skillSlug) { setShowMenu(false); return }
    setDeleting(true)
    setShowMenu(false)
    try {
      await deleteCommentApi(skillSlug, comment.id)
      onDeleted?.()
    } catch {
      setDeleting(false)
    }
  }

  if (deleting) return null

  return (
    <div className="flex gap-3 group/comment">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shrink-0 mt-0.5"
        style={{ backgroundColor: comment.avatar_color }}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-card border border-border/60 rounded-xl p-4 relative">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[13px] font-semibold text-foreground">{comment.author}</span>
            <span className="text-[11px] text-muted-foreground cursor-default" title={absoluteTime}>{timeAgo}</span>
            <div className="ml-auto relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-1 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-muted sm:opacity-0 sm:group-hover/comment:opacity-100 transition-all min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 flex items-center justify-center"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-popover border border-border rounded-lg shadow-lg overflow-hidden min-w-[100px]">
                  <button onClick={() => { setIsEditing(true); setShowMenu(false) }} className="flex items-center gap-2 px-3 py-2 text-[12px] hover:bg-muted w-full text-left text-foreground">
                    <Pencil className="h-3 w-3" /> Edit
                  </button>
                  <button onClick={handleDelete} className="flex items-center gap-2 px-3 py-2 text-[12px] hover:bg-muted w-full text-left text-destructive">
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
          {isEditing ? (
            <div>
              <textarea
                className="w-full p-2 text-sm bg-muted rounded-lg border border-border/60 resize-none focus:outline-none focus:ring-2 focus:ring-ring min-h-[80px] placeholder:text-muted-foreground"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                autoFocus
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); await handleEditSave() }
                  if (e.key === 'Escape') { setIsEditing(false); setEditValue(comment.body) }
                }}
              />
              <div className="flex justify-end gap-2 mt-2">
                <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => { setIsEditing(false); setEditValue(comment.body) }}>Cancel</Button>
                <Button size="sm" className="h-7 text-[12px] gap-1" disabled={editSaving || !editValue.trim()} onClick={handleEditSave}>
                  {editSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-[13px] text-foreground/90 leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{comment.body}</ReactMarkdown>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2 ml-1 flex-wrap">
          {reactions.map(({ emoji, count }) => (
            <button
              key={emoji}
              onClick={() => toggleReaction(emoji)}
              className="flex items-center gap-1 px-2.5 py-1 min-h-[36px] sm:min-h-0 sm:py-0.5 rounded-full bg-muted/60 hover:bg-muted border border-border/40 text-[12px] transition-colors"
            >
              <span>{emoji}</span>
              <span className="text-muted-foreground font-medium">{count}</span>
            </button>
          ))}
          <button
            onClick={() => setShowReply(!showReply)}
            className="flex items-center gap-1 px-2.5 py-1 min-h-[36px] sm:min-h-0 sm:py-0.5 rounded-full text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Reply className="h-3 w-3" />
            Reply
          </button>
        </div>
        {showReply && (
          <div className="mt-3 ml-0">
            <div className="flex gap-2">
              <textarea
                className="flex-1 p-3 text-sm bg-muted rounded-lg border border-border/60 resize-none focus:outline-none focus:ring-2 focus:ring-ring min-h-[60px] placeholder:text-muted-foreground"
                placeholder={`Reply to ${comment.author}...`}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={() => setShowReply(false)}>Cancel</Button>
              <Button size="sm" className="h-7 text-[12px]">Reply</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

type SkillCommentsTabProps = {
  comments: Comment[]
  onAddComment?: (body: string) => Promise<void>
  skillSlug?: string
}

export function SkillCommentsTab({ comments: initialComments, onAddComment, skillSlug }: SkillCommentsTabProps) {
  const [localComments, setLocalComments] = useState(initialComments)

  const handleDeletedComment = (id: string) => {
    setLocalComments(prev => prev.filter(c => c.id !== id))
  }

  return (
    <div className="flex-1 py-6 mt-0 animate-in fade-in duration-200">
      <div className="max-w-3xl">
        <CommentInput placeholder="Leave a comment..." onSubmitComment={onAddComment} />
        {localComments.length > 0 ? (
          <div className="mt-6 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{localComments.length} Comment{localComments.length !== 1 ? 's' : ''}</p>
            {localComments.map((comment) => (
              <CommentCard key={comment.id} comment={comment} skillSlug={skillSlug} onDeleted={() => handleDeletedComment(comment.id)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="w-10 h-10 rounded-xl bg-muted/80 flex items-center justify-center mb-3">
              <MessageSquare className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="text-[13px] font-medium text-foreground mb-0.5">No comments yet</p>
            <p className="text-[12px] text-muted-foreground">Be the first to leave feedback on this skill.</p>
          </div>
        )}
      </div>
    </div>
  )
}
