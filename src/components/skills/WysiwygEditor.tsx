'use client'
import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Typography from '@tiptap/extension-typography'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'
import { Extension } from '@tiptap/core'
import { parseFrontmatter, stripFrontmatter } from '@/lib/frontmatter'
import { useState, useCallback, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import {
  Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Minus, FileEdit, Eye, Link2,
  Undo2, Redo2,
} from 'lucide-react'

const TabInCodeBlock = Extension.create({
  name: 'tabInCodeBlock',
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (editor.isActive('codeBlock')) {
          editor.commands.insertContent('  ')
          return true
        }
        return false
      },
    }
  },
})

/** tiptap-markdown doesn't ship types — declare the storage shape we rely on */
interface MarkdownStorage {
  markdown: { getMarkdown: () => string }
}

type EditorMode = 'wysiwyg' | 'raw'

interface Props {
  value: string
  onChange: (markdown: string) => void
  /** Render toolbar via render prop so parent can position it (e.g. sticky) */
  renderToolbar?: (toolbar: React.ReactNode) => React.ReactNode
  /** Called when editor mode changes so parent can react (e.g. hide metadata in raw mode) */
  onModeChange?: (mode: EditorMode) => void
  /** Skill metadata — used to compose full SKILL.md frontmatter in raw mode */
  skillMeta?: { name: string; description: string; tags?: string[] }
  /** Called when frontmatter fields are edited in raw mode */
  onMetaChange?: (meta: { name: string; description: string; tags?: string[] }) => void
  /** Extra className for the root wrapper */
  className?: string
}

/** Compose full SKILL.md content with frontmatter from metadata + body */
function composeSkillMd(meta: { name: string; description: string; tags?: string[] }, body: string): string {
  const lines = ['---', `name: ${meta.name}`, `description: ${meta.description}`]
  if (meta.tags && meta.tags.length > 0) {
    lines.push(`tags: [${meta.tags.join(', ')}]`)
  }
  lines.push('---', '')
  const bodyTrimmed = body.replace(/^\n+/, '')
  return lines.join('\n') + (bodyTrimmed ? '\n' + bodyTrimmed : '\n')
}

/* ── Shared inline style constants (avoids re-creation on every render) ── */
const textareaStyle: React.CSSProperties = { whiteSpace: 'pre', overflowWrap: 'normal', lineHeight: 1.6 }

/* ── Small reusable button components ── */

function ToolbarBtn({ onClick, active, title, children }: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 w-7 h-7 flex items-center justify-center rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/80 shrink-0',
        active && 'bg-accent/15 text-accent',
      )}
    >
      {children}
    </button>
  )
}

function ModeBtn({ onClick, active, title, children }: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'flex items-center px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}


const Separator = () => <div className="w-px h-4 bg-border/40 mx-0.5" />

/* ── Formatting Toolbar (extracted sub-component) ── */

function FormattingToolbar({ editor }: { editor: Editor }) {
  const promptLink = useCallback(() => {
    const url = window.prompt('Enter URL')
    if (url) editor.chain().focus().setLink({ href: url }).run()
  }, [editor])

  return (
    <>
      <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (⌘B)">
        <Bold className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (⌘I)">
        <Italic className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Inline Code (⌘E)">
        <Code className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough (⌘⇧S)">
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <Separator />
      <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1">
        <Heading1 className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
        <Heading2 className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">
        <Heading3 className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <Separator />
      <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet List">
        <List className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered List">
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote">
        <Quote className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code Block">
        <span className="font-mono text-[10px]">{`</>`}</span>
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider">
        <Minus className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <Separator />
      <ToolbarBtn onClick={promptLink} active={editor.isActive('link')} title="Link (⌘K)">
        <Link2 className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <Separator />
      <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} title="Undo (⌘Z)">
        <Undo2 className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} title="Redo (⌘⇧Z)">
        <Redo2 className="h-3.5 w-3.5" />
      </ToolbarBtn>
    </>
  )
}

/* ── Main Editor ── */

export type { EditorMode }

export function WysiwygEditor({ value, onChange, renderToolbar, onModeChange, skillMeta, onMetaChange, className }: Props) {
  const [mode, setMode] = useState<EditorMode>('wysiwyg')
  const [rawValue, setRawValue] = useState(value)
  const [transitioning, setTransitioning] = useState(false)
  const editorWrapRef = useRef<HTMLDivElement>(null)

  // Prevent onUpdate from overwriting rawValue when we call setContent programmatically
  const settingContentRef = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Start writing your skill...',
      }),
      Link.configure({ openOnClick: false }),
      Typography,
      TabInCodeBlock,
      Markdown.configure({ html: false, transformCopiedText: true, transformPastedText: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: stripFrontmatter(value),
    editable: true,
    onUpdate: ({ editor }) => {
      // Skip when triggered by raw textarea sync or programmatic setContent
      if (settingContentRef.current) return
      const md = (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown()
      setRawValue(md)
      onChange(md)
    },
    onBlur: () => {},
  })

  // Auto-focus editor on mount, cursor at start (so editor opens at top)
  useEffect(() => {
    if (editor) {
      requestAnimationFrame(() => {
        editor.commands.focus('start')
        // Ensure the scroll container starts at top
        const scrollContainer = document.querySelector('.fixed.inset-0.z-50 > div:nth-child(2)')
        if (scrollContainer) scrollContainer.scrollTop = 0
      })
    }
  }, [editor])

  const handleModeSwitch = useCallback((newMode: EditorMode) => {
    if (newMode === mode) return
    setTransitioning(true)

    // Entering raw mode — compose full SKILL.md with frontmatter
    if (newMode === 'raw' && skillMeta) {
      const fullContent = composeSkillMd(skillMeta, rawValue)
      setRawValue(fullContent)
    }

    // Leaving raw mode — parse frontmatter back into metadata fields, push body to Tiptap
    if (mode === 'raw' && newMode !== 'raw') {
      const { data, body } = parseFrontmatter(rawValue)
      if (onMetaChange && (data.name || data.description)) {
        onMetaChange({
          name: typeof data.name === 'string' ? data.name : skillMeta?.name ?? '',
          description: typeof data.description === 'string' ? data.description : skillMeta?.description ?? '',
          tags: Array.isArray(data.tags) ? data.tags.map(String) : skillMeta?.tags,
        })
      }
      // Update the body content (without frontmatter)
      setRawValue(body)
      onChange(body)
      if (editor) {
        settingContentRef.current = true
        editor.commands.setContent(body)
        settingContentRef.current = false
      }
    }

    setMode(newMode)
    onModeChange?.(newMode)
    requestAnimationFrame(() => {
      setTimeout(() => setTransitioning(false), 150)
    })
  }, [mode, rawValue, editor, onChange, skillMeta, onMetaChange, onModeChange])


  const toolbarNode = (
    <div className="shrink-0 bg-background">
      {/* Mode toggle — always visible as its own row on mobile, inline on desktop */}
      <div className="flex items-center gap-1 px-6 py-1.5 sm:hidden border-b border-border/30">
        <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
          <ModeBtn
            active={mode === 'wysiwyg'}
            onClick={() => handleModeSwitch('wysiwyg')}
            title="Rendered"
          >
            <Eye className="h-3.5 w-3.5" />
            <span className="text-[11px] ml-1">Rendered</span>
          </ModeBtn>
          <ModeBtn
            active={mode === 'raw'}
            onClick={() => handleModeSwitch('raw')}
            title="Raw"
          >
            <FileEdit className="h-3.5 w-3.5" />
            <span className="text-[11px] ml-1">Raw</span>
          </ModeBtn>
        </div>
      </div>
      {/* Formatting toolbar — scrollable row with fade hint */}
      <div className="relative">
      <div className="flex items-center gap-0.5 px-6 sm:px-10 h-10 sm:h-9 overflow-x-auto scrollbar-hide border-b border-border/30 sm:border-b-0">
        {editor && mode !== 'raw' && <FormattingToolbar editor={editor} />}

        <div className="flex-1 min-w-4" />

        {/* Mode toggle on desktop — hidden on mobile (shown above) */}
        <div className="hidden sm:flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5 shrink-0">
          <ModeBtn
            active={mode === 'wysiwyg'}
            onClick={() => handleModeSwitch('wysiwyg')}
            title="Rendered — edit formatted text directly (WYSIWYG)"
          >
            <Eye className="h-3.5 w-3.5" />
            <span className="text-[11px] ml-1">Rendered</span>
          </ModeBtn>
          <ModeBtn
            active={mode === 'raw'}
            onClick={() => handleModeSwitch('raw')}
            title="Raw — edit plain Markdown"
          >
            <FileEdit className="h-3.5 w-3.5" />
            <span className="text-[11px] ml-1">Raw</span>
          </ModeBtn>
        </div>
      </div>
      {/* Right fade hint for scrollable toolbar on mobile */}
      <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none sm:hidden" />
      </div>
    </div>
  )

  return (
    <div className={cn('flex-1 flex flex-col', className)}>
      {/* Toolbar — rendered via parent wrapper if provided, otherwise inline */}
      {renderToolbar ? renderToolbar(toolbarNode) : toolbarNode}

      {/* Content area */}
      <div className={cn('flex-1 flex flex-col transition-opacity duration-150', transitioning && 'opacity-0')}>

        {/* ── WYSIWYG editor ── */}
        {mode === 'wysiwyg' && (
          <div
            ref={editorWrapRef}
            className="flex-1 relative flex flex-col min-h-[100vh]"
            onPasteCapture={(e) => {
              const text = e.clipboardData?.getData('text/plain')
              if (!text || !text.trimStart().startsWith('---')) return
              const stripped = stripFrontmatter(text)
              if (stripped === text) return
              e.preventDefault()
              e.stopPropagation()
              if (editor) {
                settingContentRef.current = true
                editor.commands.setContent(stripped)
                settingContentRef.current = false
                setRawValue(text)
                onChange(text)
              }
            }}
          >
            <EditorContent editor={editor} />
          </div>
        )}

        {/* ── Raw mode (full width): plain Markdown textarea showing full SKILL.md ── */}
        {mode === 'raw' && (
          <div className="flex-1 overflow-y-auto relative flex flex-col">
            <div className="px-4 sm:px-8 pt-4 pb-1">
              <span className="text-[11px] text-muted-foreground/50">
                Editing raw SKILL.md · Frontmatter (name, description) included · Switch to <strong>Rendered</strong> for WYSIWYG
              </span>
            </div>
            <textarea
              value={rawValue}
              onChange={(e) => {
                setRawValue(e.target.value)
              }}
              className="w-full flex-1 min-h-[400px] px-4 sm:px-8 py-4 font-mono text-[13px] bg-transparent resize-none focus:outline-none text-foreground/70"
              spellCheck={false}
              placeholder={"---\nname: my-skill\ndescription: What this skill does...\n---\n\n# My Skill\n\nContent here..."}
              style={textareaStyle}
            />
          </div>
        )}
      </div>
    </div>
  )
}
