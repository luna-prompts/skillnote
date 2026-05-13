'use client'
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { ArrowUp, Check, Copy, Hash, FileText, MessageSquare, Star, Bot } from 'lucide-react'
import { Skill, type Comment, type SkillRatingDetail, type SkillReview } from '@/lib/mock-data'
import { fetchSkillReviews } from '@/lib/api/skills'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { stripFrontmatter } from '@/lib/frontmatter'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { nightOwl, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useTheme } from 'next-themes'
import { SkillCommentsTab } from './SkillCommentsTab'

function slugify(text: string) {
  return text.toLowerCase().replace(/[^\w]+/g, '-').replace(/(^-|-$)/g, '')
}

/** Recursively flatten React children to their text content. Walks into
 *  inline elements (`<code>`, `<strong>`, `<em>`, …) so that `# \`bar\`` and
 *  `# foo **bold**` produce useful heading anchors. */
function extractHeadingText(children: React.ReactNode): string {
  if (children === null || children === undefined || typeof children === 'boolean') return ''
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractHeadingText).join('')
  if (React.isValidElement(children)) {
    const inner = (children.props as { children?: React.ReactNode }).children
    return extractHeadingText(inner)
  }
  return ''
}

/** Slug for a heading anchor. Returns empty string when the heading has no
 *  extractable text — caller renders the heading without an anchor in that
 *  case rather than producing `href="#undefined"` (R5 live-bug L3). */
function headingId(children: React.ReactNode): string {
  const text = extractHeadingText(children).trim()
  if (!text) return ''
  return slugify(text)
}

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [code])
  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-md bg-muted-foreground/10 hover:bg-muted-foreground/20 text-muted-foreground hover:text-foreground transition-all"
      aria-label="Copy code"
    >
      <span className={cn('inline-block transition-transform duration-200', copied && 'scale-110')}>
        {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3.5 w-3.5" />}
      </span>
    </button>
  )
}

function HeadingAnchor({ id, size }: { id: string; size: string }) {
  const [copied, setCopied] = useState(false)
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    const url = `${window.location.origin}${window.location.pathname}#${id}`
    navigator.clipboard.writeText(url).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
    window.history.replaceState(null, '', `#${id}`)
  }
  return (
    <a href={`#${id}`} onClick={handleClick} className="ml-2 opacity-0 group-hover/heading:opacity-100 transition-opacity text-muted-foreground hover:text-accent relative" aria-label="Copy link">
      {copied ? <Check className={cn('inline', size)} /> : <Hash className={cn('inline', size)} />}
      {copied && (
        <span className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[10px] bg-accent text-white rounded whitespace-nowrap">
          Copied!
        </span>
      )}
    </a>
  )
}



function ScrollProgressBar({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      const max = scrollHeight - clientHeight
      setProgress(max > 0 ? (scrollTop / max) * 100 : 0)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [containerRef])
  if (progress <= 0) return null
  return (
    <div className="sticky top-0 z-10 h-0.5 bg-border/30">
      <div className="h-full bg-accent transition-[width] duration-100" style={{ width: `${progress}%` }} />
    </div>
  )
}

function ScrollToTopButton({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => setVisible(el.scrollTop > 300)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [containerRef])
  if (!visible) return null
  return (
    <button
      onClick={() => containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
      className="fixed bottom-20 right-4 lg:bottom-6 lg:right-[calc(theme(spacing.64)+1.5rem)] z-30 p-2.5 rounded-full bg-accent text-white shadow-lg hover:bg-accent/90 transition-all"
      aria-label="Scroll to top"
    >
      <ArrowUp className="h-4 w-4" />
    </button>
  )
}

function StarRating({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'md' }) {
  const cls = size === 'md' ? 'h-4 w-4' : 'h-3 w-3'
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={cn(cls, i <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/20')} />
      ))}
    </span>
  )
}

function RatingDistribution({ reviews }: { reviews: SkillReview[] }) {
  const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } as Record<number, number>
  for (const r of reviews) dist[r.rating] = (dist[r.rating] || 0) + 1
  const total = reviews.length
  return (
    <div className="space-y-1.5">
      {[5, 4, 3, 2, 1].map(star => {
        const count = dist[star]
        const pct = total > 0 ? (count / total) * 100 : 0
        return (
          <div key={star} className="flex items-center gap-2.5 text-[12px]">
            <span className="text-muted-foreground w-12 text-right shrink-0">{star} star</span>
            <div className="flex-1 h-2 bg-muted/60 rounded-full overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-muted-foreground/60 w-8 text-right tabular-nums shrink-0">{pct > 0 ? `${Math.round(pct)}%` : ''}</span>
          </div>
        )
      })}
    </div>
  )
}

function ReviewCard({ review }: { review: SkillReview }) {
  const date = review.created_at ? new Date(review.created_at) : null
  const timeAgo = date ? formatTimeAgo(date) : ''
  return (
    <div className="py-4 first:pt-0">
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-accent/10 text-accent shrink-0">
          <Bot className="h-3 w-3" />
        </span>
        <span className="text-[13px] font-medium text-foreground">{review.agent_name || 'Unknown agent'}</span>
        {review.skill_version && (
          <span className="text-[11px] font-mono text-muted-foreground/50">v{review.skill_version}</span>
        )}
      </div>
      <div className="flex items-center gap-2 mb-1.5 pl-[34px]">
        <StarRating rating={review.rating} />
        {timeAgo && <span className="text-[11px] text-muted-foreground/50">{timeAgo}</span>}
      </div>
      {review.outcome && (
        <p className="text-[13px] text-muted-foreground leading-relaxed pl-[34px]">{review.outcome}</p>
      )}
    </div>
  )
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

function formatTimeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const REVIEWS_PAGE_SIZE = 10

type SkillViewTabProps = {
  skill: Skill
  onAddComment?: (body: string) => Promise<Comment | void>
  ratingDetail?: SkillRatingDetail | null
  reviews?: SkillReview[]
}

export function SkillViewTab({ skill, onAddComment, ratingDetail, reviews: initialReviews = [] }: SkillViewTabProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const viewContentRef = useRef<HTMLDivElement>(null)

  const strippedContent = useMemo(
    // Also drop HTML comments so build-tool metadata like
    // "<!-- AUTO-GENERATED from SKILL.md.tmpl -->" doesn't render as text.
    () => stripFrontmatter(skill.content_md).replace(/<!--[\s\S]*?-->/g, ''),
    [skill.content_md],
  )

  // Paginated reviews
  const [reviews, setReviews] = useState<SkillReview[]>(initialReviews)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(initialReviews.length >= REVIEWS_PAGE_SIZE)
  const totalCount = ratingDetail?.rating_count ?? 0

  // Sync when initial reviews change (e.g. navigating between skills)
  useEffect(() => {
    setReviews(initialReviews)
    setHasMore(initialReviews.length >= REVIEWS_PAGE_SIZE)
  }, [initialReviews])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const more = await fetchSkillReviews(skill.slug, REVIEWS_PAGE_SIZE, reviews.length)
      if (more.length < REVIEWS_PAGE_SIZE) setHasMore(false)
      setReviews(prev => [...prev, ...more])
    } catch {
      // Don't disable hasMore on transient errors — user can retry
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, skill.slug, reviews.length])

  return (
    <div className="flex-1 mt-0 overflow-y-auto overflow-x-hidden scroll-smooth animate-in fade-in duration-200" ref={viewContentRef}>
      <ScrollProgressBar containerRef={viewContentRef} />
      {/* File header bar */}
      <div className="flex items-center gap-2.5 px-4 sm:px-8 py-2.5 bg-muted/20">
        <FileText className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
        <span className="font-mono text-[12px] text-muted-foreground/60 shrink-0 tracking-wide">SKILL.md</span>
      </div>
      <hr className="border-border/30 mx-0" />
      <div className="flex gap-8 px-4 sm:px-10 lg:px-14 py-6 sm:py-8 overflow-hidden">
        <div className="flex-1 min-w-0 overflow-hidden max-w-[48rem]">
          <div className="ProseMirror skill-view-content max-w-none" style={{ padding: 0 }}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                pre({ children }) {
                  return <>{children}</>
                },
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '')
                  const codeString = String(children).replace(/\n$/, '')
                  if (match) {
                    return (
                      <div className="relative group/pre my-4 not-prose max-w-[calc(100vw-2rem)] sm:max-w-none overflow-hidden" style={{ borderRadius: '12px' }}>
                        {/* Language label + copy — hover overlay, top-right */}
                        <div className="absolute top-2.5 right-3 flex items-center gap-2 z-10 opacity-0 group-hover/pre:opacity-100 transition-opacity">
                          <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>{match[1]}</span>
                          <CopyCodeButton code={codeString} />
                        </div>
                        <SyntaxHighlighter
                          style={isDark ? nightOwl : oneLight}
                          language={match[1]}
                          PreTag="div"
                          customStyle={{ margin: 0, borderRadius: '12px', fontSize: '13px', lineHeight: '1.6', padding: '1.25rem 1.5rem', background: isDark ? '#011627' : '#f0f1f3', border: isDark ? 'none' : '1px solid #dde0e4', overflowX: 'auto', maxWidth: '100%' }}
                        >
                          {codeString}
                        </SyntaxHighlighter>
                      </div>
                    )
                  }
                  return <code className={className} {...props}>{children}</code>
                },
                h1({ children }) {
                  const id = headingId(children)
                  return (
                    <h1 id={id || undefined} className="group/heading scroll-mt-6">
                      {children}
                      {id ? <HeadingAnchor id={id} size="h-4 w-4" /> : null}
                    </h1>
                  )
                },
                h2({ children }) {
                  const id = headingId(children)
                  return (
                    <h2 id={id || undefined} className="group/heading scroll-mt-6">
                      {children}
                      {id ? <HeadingAnchor id={id} size="h-3.5 w-3.5" /> : null}
                    </h2>
                  )
                },
                h3({ children }) {
                  const id = headingId(children)
                  return (
                    <h3 id={id || undefined} className="group/heading scroll-mt-6">
                      {children}
                      {id ? <HeadingAnchor id={id} size="h-3 w-3" /> : null}
                    </h3>
                  )
                },
                h4({ children }) {
                  const id = headingId(children)
                  return (
                    <h4 id={id || undefined} className="group/heading scroll-mt-6">
                      {children}
                      {id ? <HeadingAnchor id={id} size="h-3 w-3" /> : null}
                    </h4>
                  )
                },
                a({ href, children }) {
                  const isExternal = href?.startsWith('http')
                  return (
                    <a href={href} {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="text-accent hover:underline">
                      {children}
                    </a>
                  )
                },
                table({ children }) {
                  return (
                    <div className="my-5 overflow-x-auto not-prose max-w-[calc(100vw-2rem)] sm:max-w-none">
                      <table className="w-full border-collapse text-[14px]">{children}</table>
                    </div>
                  )
                },
                thead({ children }) {
                  return <thead className="border-b border-border/60">{children}</thead>
                },
                tbody({ children }) {
                  return <tbody className="divide-y divide-border/40">{children}</tbody>
                },
                tr({ children }) {
                  return <tr className="transition-colors hover:bg-muted/30">{children}</tr>
                },
                th({ children }) {
                  return <th className="px-4 py-2.5 text-left text-[12px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{children}</th>
                },
                td({ children }) {
                  return <td className="px-4 py-2.5 text-[14px] text-foreground align-top">{children}</td>
                },
              }}
            >
              {strippedContent}
            </ReactMarkdown>
          </div>
        </div>
      </div>


      {/* Agent Reviews */}
      {(reviews.length > 0 || (ratingDetail && ratingDetail.rating_count > 0)) && (
        <div id="agent-reviews" className="px-4 sm:px-10 lg:px-14 pb-8 scroll-mt-4">
          <div className="border-t border-border/40 pt-8 mt-2 max-w-[48rem]">
            <h2 className="text-[13px] font-semibold text-foreground/90 mb-6 flex items-center gap-2 uppercase tracking-wide">
              <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
              Agent Reviews
              {ratingDetail && ratingDetail.rating_count > 0 && (
                <span className="text-[10px] font-semibold text-muted-foreground bg-muted/80 rounded-full px-2 py-0.5 normal-case tracking-normal">
                  {formatCount(ratingDetail.rating_count)}
                </span>
              )}
            </h2>

            {/* Summary + distribution */}
            <div className="flex flex-col sm:flex-row gap-6 sm:gap-10 mb-6">
              {/* Big average */}
              {ratingDetail && ratingDetail.avg_rating != null && (
                <div className="flex flex-col items-center sm:items-start shrink-0">
                  <span className="text-4xl font-bold text-foreground tabular-nums">{ratingDetail.avg_rating.toFixed(1)}</span>
                  <StarRating rating={Math.round(ratingDetail.avg_rating)} size="md" />
                  <span className="text-[12px] text-muted-foreground mt-1">{formatCount(ratingDetail.rating_count)} rating{ratingDetail.rating_count !== 1 ? 's' : ''}</span>
                </div>
              )}
              {/* Distribution bars */}
              {reviews.length > 0 && (
                <div className="flex-1 min-w-0 max-w-xs">
                  <RatingDistribution reviews={reviews} />
                </div>
              )}
            </div>

            {/* Individual reviews */}
            {reviews.length > 0 && (
              <>
                <div className="divide-y divide-border/40">
                  {reviews.map(review => (
                    <ReviewCard key={review.id} review={review} />
                  ))}
                </div>

                {/* Load more / progress */}
                {hasMore && (
                  <div className="pt-4 flex items-center gap-3">
                    <button
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="text-[13px] font-medium text-accent hover:text-accent/80 disabled:opacity-50 transition-colors"
                    >
                      {loadingMore ? 'Loading...' : 'Show more reviews'}
                    </button>
                    {totalCount > 0 && (
                      <span className="text-[11px] text-muted-foreground/40">
                        Showing {reviews.length} of {formatCount(totalCount)}
                      </span>
                    )}
                  </div>
                )}
                {!hasMore && reviews.length > REVIEWS_PAGE_SIZE && (
                  <p className="text-[11px] text-muted-foreground/40 pt-4">
                    All {formatCount(totalCount)} reviews loaded
                  </p>
                )}
              </>
            )}

            {/* Empty state — has rating but no reviews fetched */}
            {reviews.length === 0 && ratingDetail && ratingDetail.rating_count > 0 && (
              <p className="text-[13px] text-muted-foreground/60">Rating data available but no individual reviews yet.</p>
            )}
          </div>
        </div>
      )}

      {/* TODO: Re-enable comments when ACL is ready
      <div className="px-4 sm:px-10 lg:px-14 pb-20 lg:pb-12">
        <div className="border-t border-border/40 pt-8 mt-6 max-w-[48rem]">
          <h2 className="text-[13px] font-semibold text-foreground/90 mb-6 flex items-center gap-2 uppercase tracking-wide">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/60" />
            Comments
            {(skill.comments?.length ?? 0) > 0 && (
              <span className="text-[10px] font-semibold text-muted-foreground bg-muted/80 rounded-full px-2 py-0.5 normal-case tracking-normal">
                {skill.comments?.length}
              </span>
            )}
          </h2>
          <SkillCommentsTab comments={skill.comments ?? []} onAddComment={onAddComment} skillSlug={skill.slug} />
        </div>
      </div>
      */}

      <ScrollToTopButton containerRef={viewContentRef} />
    </div>
  )
}
