'use client'

import { Suspense, useState, useCallback, useEffect } from 'react'
import { SkillEditTab } from '@/components/skills/tabs/SkillEditTab'
import { createSkill } from '@/lib/skills-store'
import { validateSkillName, validateDescription, normalizeSkillName } from '@/lib/skill-validation'
import { parseFrontmatter, stripFrontmatter } from '@/lib/frontmatter'
import { toast } from 'sonner'
import { useRouter, useSearchParams } from 'next/navigation'

export default function NewSkillPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="h-5 w-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" /></div>}>
      <NewSkillContent />
    </Suspense>
  )
}

function NewSkillContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Pre-fill from URL search params (used by import flow)
  const [name, setName] = useState(() => normalizeSkillName(searchParams.get('name') || ''))
  const [description, setDescription] = useState(() => searchParams.get('description') || '')
  const [content, setContent] = useState(() => searchParams.get('content') || '')
  const [collections, setCollections] = useState<string[]>(() => {
    const c = searchParams.get('collections')
    return c ? c.split(',').filter(Boolean) : []
  })
  const [saving, setSaving] = useState(false)

  // Cmd+S → save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  })

  // When editor content changes, auto-extract frontmatter from pasted content
  const handleContentChange = useCallback((md: string) => {
    setContent(md)
    if (md.trimStart().startsWith('---')) {
      const { data } = parseFrontmatter(md)
      if (data.name && typeof data.name === 'string' && !name) {
        setName(normalizeSkillName(String(data.name)))
      }
      if (data.description && typeof data.description === 'string' && !description) {
        setDescription(String(data.description))
      }
    }
  }, [name, description])

  const handleSave = useCallback(async () => {
    if (validateSkillName(name).length > 0 || validateDescription(description).length > 0) return
    setSaving(true)
    try {
      // Strip any existing frontmatter from pasted content to avoid duplication
      const bodyContent = stripFrontmatter(content).trim() || `# ${name.trim()}\n\n`

      const skill = await createSkill({
        title: name.trim(),
        description: description.trim(),
        content_md: bodyContent,
        tags: [],
        collections,
      })
      toast.success(`"${skill.title}" created`)
      router.push(`/skills/${skill.slug}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create skill')
    } finally {
      setSaving(false)
    }
  }, [name, description, content, collections, router])

  return (
    <SkillEditTab
      mode="create"
      editorContent={content}
      setEditorContent={handleContentChange}
      editorDirty={false}
      onDiscard={() => {}}
      onSave={handleSave}
      onCancel={() => router.push('/')}
      skillTitle={name}
      setSkillTitle={setName}
      skillDescription={description}
      setSkillDescription={setDescription}
      skillCollections={collections}
      setSkillCollections={setCollections}
      saving={saving}
    />
  )
}
