'use client'
import { TopBar } from '@/components/layout/topbar'
import { SkillListItem } from '@/components/skills/skill-list-item'
import { AddSkillsModal } from '@/components/collections/AddSkillsModal'
import { ArrowLeft, FolderOpen, Minus, Plus, Loader2, Pencil, Trash2, Check, X } from 'lucide-react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getSkills, syncSkillsFromApi, saveSkillEdit } from '@/lib/skills-store'
import { type Skill } from '@/lib/mock-data'
import { toast } from 'sonner'

function getCollectionMeta(name: string): { description: string } {
  try {
    const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
    return meta[name] || { description: '' }
  } catch { return { description: '' } }
}

function saveCollectionMeta(name: string, data: { description: string }) {
  try {
    const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
    meta[name] = { ...meta[name], ...data }
    localStorage.setItem('skillnote:collections-meta', JSON.stringify(meta))
  } catch {}
}

function renameCollection(oldName: string, newName: string) {
  try {
    // Update all skills that have this collection
    const skills = getSkills()
    for (const skill of skills) {
      if ((skill.collections || []).some(c => c.toLowerCase() === oldName.toLowerCase())) {
        const updated = skill.collections!.map(c =>
          c.toLowerCase() === oldName.toLowerCase() ? newName : c
        )
        saveSkillEdit(skill.slug, { collections: updated })
      }
    }
    // Update meta
    const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
    if (meta[oldName]) {
      meta[newName] = { ...meta[oldName] }
      delete meta[oldName]
      localStorage.setItem('skillnote:collections-meta', JSON.stringify(meta))
    }
  } catch {}
}

function deleteCollectionMeta(name: string) {
  try {
    const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
    delete meta[name]
    localStorage.setItem('skillnote:collections-meta', JSON.stringify(meta))
  } catch {}
}

export default function CollectionDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [skills, setSkills] = useState(getSkills())
  const [showAddModal, setShowAddModal] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  // Inline edit state
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const editNameRef = useRef<HTMLInputElement>(null)

  // Confirm delete state
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    syncSkillsFromApi().then(setSkills).catch(() => {})
  }, [])

  const collectionName = decodeURIComponent(slug).replace(/-/g, ' ')
  const collectionMeta = useMemo(() => getCollectionMeta(collectionName), [collectionName, skills])

  const filtered = useMemo(
    () => skills.filter(s => (s.collections || []).some(c => c.toLowerCase() === collectionName.toLowerCase())),
    [skills, collectionName]
  )

  function refreshSkills() {
    setSkills(getSkills())
    syncSkillsFromApi().then(setSkills).catch(() => {})
  }

  // Open inline edit
  function startEdit() {
    setEditName(collectionName)
    setEditDesc(collectionMeta.description || '')
    setEditing(true)
    setTimeout(() => editNameRef.current?.focus(), 0)
  }

  function cancelEdit() {
    setEditing(false)
  }

  async function saveEdit() {
    const newName = editName.trim()
    if (!newName) return
    setSavingEdit(true)
    try {
      if (newName !== collectionName) {
        renameCollection(collectionName, newName)
      }
      saveCollectionMeta(newName, { description: editDesc.trim() })
      toast.success('Collection updated')
      setEditing(false)
      refreshSkills()
      // Navigate to new slug if renamed
      if (newName !== collectionName) {
        const newSlug = newName.toLowerCase().replace(/\s+/g, '-')
        router.replace(`/collections/${newSlug}`)
      }
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleDelete() {
    // Remove this collection from all skills
    for (const skill of filtered) {
      const updated = (skill.collections || []).filter(c => c.toLowerCase() !== collectionName.toLowerCase())
      await saveSkillEdit(skill.slug, { collections: updated })
    }
    deleteCollectionMeta(collectionName)
    toast.success(`Collection "${collectionName}" deleted`)
    router.push('/collections')
  }

  async function handleRemove(skill: Skill) {
    setRemoving(skill.slug)
    try {
      const updatedCollections = (skill.collections || []).filter(
        c => c.toLowerCase() !== collectionName.toLowerCase()
      )
      await saveSkillEdit(skill.slug, { collections: updatedCollections })
      toast.success(`Removed from ${collectionName}`, { description: skill.title })
      setConfirmRemove(null)
      refreshSkills()
    } catch {
      toast.error('Failed to remove skill')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-auto">

        {/* Header */}
        <div className="px-6 py-5 border-b border-border/60">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 mb-4">
            <Link
              href="/collections"
              className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Collections
            </Link>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0 mt-0.5">
                <FolderOpen className="h-5 w-5 text-accent" />
              </div>

              {editing ? (
                /* ── Inline edit form ── */
                <div className="flex-1 min-w-0">
                  <input
                    ref={editNameRef}
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit() }}
                    className="w-full text-[17px] font-semibold text-foreground bg-transparent border-b border-border focus:outline-none focus:border-accent pb-0.5 mb-2"
                    placeholder="Collection name"
                  />
                  <textarea
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') cancelEdit() }}
                    rows={1}
                    placeholder="Description (optional)"
                    className="w-full text-[12px] text-muted-foreground bg-transparent border-b border-border/40 focus:outline-none focus:border-accent resize-none leading-relaxed pb-0.5"
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={saveEdit}
                      disabled={!editName.trim() || savingEdit}
                      className="flex items-center gap-1 h-6 px-2.5 rounded-md text-[12px] font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
                    >
                      {savingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Save
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="flex items-center gap-1 h-6 px-2.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    >
                      <X className="h-3 w-3" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Display mode ── */
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h1 className="text-[17px] font-semibold text-foreground leading-tight capitalize">
                      {collectionName}
                    </h1>
                    <button
                      onClick={startEdit}
                      className="opacity-0 group-hover:opacity-100 h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/60 transition-all [.header:hover_&]:opacity-100"
                      title="Edit collection"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                  {collectionMeta.description ? (
                    <p className="text-[12px] text-muted-foreground/70 mt-0.5 leading-relaxed">
                      {collectionMeta.description}
                    </p>
                  ) : (
                    <p className="text-[12px] text-muted-foreground/40 mt-0.5">
                      {filtered.length} {filtered.length === 1 ? 'skill' : 'skills'}
                    </p>
                  )}
                  {collectionMeta.description && (
                    <p className="text-[11px] text-muted-foreground/40 mt-0.5">
                      {filtered.length} {filtered.length === 1 ? 'skill' : 'skills'}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            {!editing && (
              <div className="flex items-center gap-2 shrink-0 mt-0.5">
                {/* Edit */}
                <button
                  onClick={startEdit}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
                  title="Edit collection"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>

                {/* Delete */}
                {confirmDelete ? (
                  <div className="flex items-center gap-1.5 animate-in fade-in duration-100">
                    <span className="text-[12px] text-muted-foreground">Delete?</span>
                    <button
                      onClick={handleDelete}
                      className="h-7 px-2.5 rounded-md text-[12px] font-medium text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="h-7 px-2.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Delete collection"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}

                {/* Add Skills */}
                <button
                  onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90 active:scale-95 transition-all"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Skills
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Skill list */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6">
            <div className="w-14 h-14 rounded-2xl bg-muted/60 border border-border/40 flex items-center justify-center mb-4">
              <FolderOpen className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <p className="text-[14px] font-medium text-foreground mb-1">Empty collection</p>
            <p className="text-[13px] text-muted-foreground text-center max-w-[260px] mb-5 leading-relaxed">
              Add your first skill to start building this collection.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 h-8 px-4 rounded-lg text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90 active:scale-95 transition-all"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Skills
            </button>
          </div>
        ) : (
          <div>
            {filtered.map(skill => {
              const isPending = confirmRemove === skill.slug
              const isRemoving = removing === skill.slug

              return (
                <div key={skill.slug} className="border-b border-border/40 last:border-0">
                  {isPending ? (
                    /* Inline remove confirmation */
                    <div className="flex items-center justify-between px-4 py-3.5 bg-destructive/[0.04] animate-in fade-in slide-in-from-top-1 duration-150">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                          <Minus className="h-3.5 w-3.5 text-destructive" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-foreground truncate">{skill.title}</p>
                          <p className="text-[12px] text-muted-foreground">Remove from &quot;{collectionName}&quot;?</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-3">
                        <button
                          onClick={() => setConfirmRemove(null)}
                          className="h-7 px-3 rounded-md text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
                        >
                          Keep
                        </button>
                        <button
                          onClick={() => handleRemove(skill)}
                          disabled={isRemoving}
                          className="h-7 px-3 rounded-md text-[12px] font-medium text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors disabled:opacity-60 flex items-center gap-1.5"
                        >
                          {isRemoving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Normal row */
                    <div className="relative group/row">
                      <SkillListItem skill={skill} />
                      {/* Remove button — subtle but visible, not opacity-0 */}
                      <button
                        onClick={() => setConfirmRemove(skill.slug)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground/25 hover:text-destructive hover:bg-destructive/10 group-hover/row:text-muted-foreground/50 transition-all duration-150"
                        title="Remove from collection"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>

      {showAddModal && (
        <AddSkillsModal
          collectionName={collectionName}
          allSkills={skills}
          onClose={() => setShowAddModal(false)}
          onAdded={refreshSkills}
        />
      )}
    </>
  )
}
