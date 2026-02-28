'use client'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { ArrowUp, Check, Copy, Hash, FileText, MessageSquare } from 'lucide-react'
import { Skill, type Comment } from '@/lib/mock-data'
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

type SkillViewTabProps = {
  skill: Skill
  onAddComment?: (body: string) => Promise<Comment | void>
}

export function SkillViewTab({ skill, onAddComment }: SkillViewTabProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const viewContentRef = useRef<HTMLDivElement>(null)

  const strippedContent = useMemo(() => stripFrontmatter(skill.content_md), [skill.content_md])

  return (
    <div className="flex-1 mt-0 overflow-y-auto overflow-x-hidden scroll-smooth animate-in fade-in duration-200" ref={viewContentRef}>
      <ScrollProgressBar containerRef={viewContentRef} />
      {/* File header bar */}
      <div className="flex items-center gap-2.5 px-4 sm:px-8 py-2.5 bg-muted/20">
        <FileText className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
        <span className="font-mono text-[12px] text-muted-foreground/60 shrink-0 tracking-wide">SKILLS.md</span>
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
                  const text = String(children)
                  const id = slugify(text)
                  return <h1 id={id} className="group/heading scroll-mt-6">{children}<HeadingAnchor id={id} size="h-4 w-4" /></h1>
                },
                h2({ children }) {
                  const text = String(children)
                  const id = slugify(text)
                  return <h2 id={id} className="group/heading scroll-mt-6">{children}<HeadingAnchor id={id} size="h-3.5 w-3.5" /></h2>
                },
                h3({ children }) {
                  const text = String(children)
                  const id = slugify(text)
                  return <h3 id={id} className="group/heading scroll-mt-6">{children}<HeadingAnchor id={id} size="h-3 w-3" /></h3>
                },
                h4({ children }) {
                  const text = String(children)
                  const id = slugify(text)
                  return <h4 id={id} className="group/heading scroll-mt-6">{children}<HeadingAnchor id={id} size="h-3 w-3" /></h4>
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
              {stripFrontmatter(skill.content_md)}
            </ReactMarkdown>
          </div>
        </div>
      </div>


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
