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
import { transformFrontmatterToTable, stripFrontmatter } from '@/lib/frontmatter'
import { useState, useCallback, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import {
  Bold, Italic, Strikethrough, Code, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Minus, Columns2, FileEdit, Eye, Link2,
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

type EditorMode = 'wysiwyg' | 'raw' | 'split'

interface Props {
  value: string
  onChange: (markdown: string) => void
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

export function WysiwygEditor({ value, onChange }: Props) {
  const [mode, setMode] = useState<EditorMode>('wysiwyg')
  const [rawValue, setRawValue] = useState(value)
  const [transitioning, setTransitioning] = useState(false)
  const editorWrapRef = useRef<HTMLDivElement>(null)

  // Prevent feedback loop when syncing raw textarea → Tiptap editor
  const syncingFromRaw = useRef(false)
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
      if (syncingFromRaw.current || settingContentRef.current) return
      const md = (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown()
      setRawValue(md)
      onChange(md)
    },
    onBlur: () => {},
  })

  // Auto-focus editor on mount, cursor at end
  useEffect(() => {
    if (editor) {
      requestAnimationFrame(() => {
        editor.commands.focus('end')
      })
    }
  }, [editor])

  const handleModeSwitch = useCallback((newMode: EditorMode) => {
    if (newMode === mode) return
    setTransitioning(true)
    // When leaving raw mode, push the raw text back into the Tiptap editor
    // Strip frontmatter so --- isn't rendered as HR in WYSIWYG
    if (mode === 'raw' && newMode !== 'raw' && editor) {
      settingContentRef.current = true
      editor.commands.setContent(stripFrontmatter(rawValue))
      settingContentRef.current = false
    }
    setMode(newMode)
    requestAnimationFrame(() => {
      setTimeout(() => setTransitioning(false), 150)
    })
  }, [mode, rawValue, editor, onChange])

  // Handle edits from the raw textarea (used in both 'raw' mode and split mode right pane)
  const handleRawChange = useCallback((newVal: string) => {
    setRawValue(newVal)
    onChange(newVal)
    // In split mode, sync the raw edit back to the Tiptap editor (left pane)
    if (editor) {
      syncingFromRaw.current = true
      editor.commands.setContent(newVal)
      // Reset flag after Tiptap's onUpdate has had a chance to fire
      setTimeout(() => { syncingFromRaw.current = false }, 0)
    }
  }, [editor, onChange])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="shrink-0">
        {/* Mode toggle — always visible as its own row on mobile, inline on desktop */}
        <div className="flex items-center gap-1 px-3 py-1.5 sm:hidden border-b border-border/30">
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
        <div className="flex items-center gap-0.5 px-3 h-10 sm:h-9 overflow-x-auto scrollbar-hide border-b border-border/30 sm:border-b-0">
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
            <ModeBtn
              active={mode === 'split'}
              onClick={() => handleModeSwitch('split')}
              title="Split — WYSIWYG editor (left) + raw Markdown textarea (right), both live-synced"
            >
              <Columns2 className="h-3.5 w-3.5" />
              <span className="text-[11px] ml-1">Split</span>
            </ModeBtn>
          </div>
        </div>
        {/* Right fade hint for scrollable toolbar on mobile */}
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none sm:hidden" />
        </div>
      </div>

      {/* Content area */}
      <div className={cn('flex-1 min-h-0 flex flex-col sm:flex-row transition-opacity duration-150', transitioning && 'opacity-0')}>

        {/* ── LEFT PANE: Tiptap WYSIWYG editor (wysiwyg mode + split left) ── */}
        {(mode === 'wysiwyg' || mode === 'split') && (
          <div
            ref={editorWrapRef}
            className={cn(
              'flex-1 overflow-y-auto relative flex flex-col',
              mode === 'split' && 'sm:border-r border-border/40 sm:w-1/2 sm:flex-none',
            )}
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
                // rawValue keeps the ORIGINAL text so Raw mode shows --- frontmatter
                setRawValue(text)
                onChange(text)
              }
            }}
          >
            {mode === 'split' && (
              <div className="hidden sm:block px-4 py-1.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest border-b border-border/30 shrink-0">
                Rendered (editable)
              </div>
            )}
            <EditorContent editor={editor} className="flex-1" />
          </div>
        )}

        {/* ── RIGHT PANE (split mode only): Raw Markdown textarea, live-synced — hidden on mobile */}
        {mode === 'split' && (
          <div className="hidden sm:flex flex-none sm:w-1/2 overflow-y-auto relative flex-col min-h-[200px] sm:min-h-0">
            <div className="px-4 py-1.5 text-[10px] font-medium text-muted-foreground/60 uppercase tracking-widest border-b border-border/30 shrink-0">
              Raw Markdown
            </div>
            <textarea
              value={rawValue}
              onChange={(e) => handleRawChange(e.target.value)}
              className="w-full flex-1 min-h-0 px-6 py-4 font-mono text-[13px] bg-muted/10 resize-none focus:outline-none text-foreground/70 focus:text-foreground transition-colors"
              spellCheck={false}
              placeholder="Raw markdown synced with the editor on the left..."
              style={textareaStyle}
            />
          </div>
        )}

        {/* ── Raw mode (full width): plain Markdown textarea ── */}
        {mode === 'raw' && (
          <div className="flex-1 overflow-y-auto relative flex flex-col">
            <div className="px-4 sm:px-8 pt-4 pb-1">
              <span className="text-[11px] text-muted-foreground/50">
                Editing raw Markdown · Switch to <strong>Rendered</strong> for WYSIWYG or <strong>Split</strong> for side-by-side
              </span>
            </div>
            <textarea
              value={rawValue}
              onChange={(e) => {
                setRawValue(e.target.value)
                onChange(e.target.value)
              }}
              className="w-full flex-1 min-h-[400px] px-4 sm:px-8 py-4 font-mono text-[13px] bg-transparent resize-none focus:outline-none text-foreground/70"
              spellCheck={false}
              placeholder="Write markdown here..."
              style={textareaStyle}
            />
          </div>
        )}
      </div>
    </div>
  )
}
