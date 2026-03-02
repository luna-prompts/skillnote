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

function readMeta(name: string): { description: string } {
  try {
    const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
    return meta[name] || { description: '' }
  } catch { return { description: '' } }
}

function writeMeta(name: string, data: { description: string }) {
  try {
    const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
    meta[name] = { ...meta[name], ...data }
    localStorage.setItem('skillnote:collections-meta', JSON.stringify(meta))
  } catch {}
}

function renameMeta(oldName: string, newName: string) {
  try {
    const skills = getSkills()
    for (const s of skills) {
      if ((s.collections || []).some(c => c.toLowerCase() === oldName.toLowerCase())) {
        saveSkillEdit(s.slug, {
          collections: s.collections!.map(c =>
            c.toLowerCase() === oldName.toLowerCase() ? newName : c
          ),
        })
      }
    }
    const meta = JSON.parse(localStorage.getItem('skillnote:collections-meta') || '{}')
    if (meta[oldName]) { meta[newName] = { ...meta[oldName] }; delete meta[oldName] }
    localStorage.setItem('skillnote:collections-meta', JSON.stringify(meta))
  } catch {}
}

function deleteMeta(name: string) {
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

  // Per-row remove state
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  // Inline edit state
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const editNameRef = useRef<HTMLInputElement>(null)

  // Delete state
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    syncSkillsFromApi().then(setSkills).catch(() => {})
  }, [])

  const collectionName = decodeURIComponent(slug).replace(/-/g, ' ')
  const meta = useMemo(() => readMeta(collectionName), [collectionName, skills]) // eslint-disable-line

  const filtered = useMemo(
    () => skills.filter(s => (s.collections || []).some(c => c.toLowerCase() === collectionName.toLowerCase())),
    [skills, collectionName]
  )

  function refresh() {
    setSkills(getSkills())
    syncSkillsFromApi().then(setSkills).catch(() => {})
  }

  function startEdit() {
    setEditName(collectionName)
    setEditDesc(meta.description || '')
    setEditing(true)
    setTimeout(() => editNameRef.current?.focus(), 0)
  }

  async function saveEdit() {
    const newName = editName.trim()
    if (!newName) return
    setSavingEdit(true)
    try {
      if (newName !== collectionName) renameMeta(collectionName, newName)
      writeMeta(newName, { description: editDesc.trim() })
      toast.success('Collection updated')
      setEditing(false)
      refresh()
      if (newName !== collectionName) {
        router.replace(`/collections/${newName.toLowerCase().replace(/\s+/g, '-')}`)
      }
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleDeleteCollection() {
    for (const skill of filtered) {
      const updated = (skill.collections || []).filter(c => c.toLowerCase() !== collectionName.toLowerCase())
      await saveSkillEdit(skill.slug, { collections: updated })
    }
    deleteMeta(collectionName)
    toast.success(`"${collectionName}" deleted`)
    router.push('/collections')
  }

  async function handleRemove(skill: Skill) {
    setRemoving(skill.slug)
    try {
      const updated = (skill.collections || []).filter(c => c.toLowerCase() !== collectionName.toLowerCase())
      await saveSkillEdit(skill.slug, { collections: updated })
      toast.success(`Removed from "${collectionName}"`, { description: skill.title })
      setConfirmRemove(null)
      refresh()
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

        {/* ── Header ── */}
        <div className="px-6 py-5 border-b border-border/50">
          {/* Breadcrumb */}
          <Link
            href="/collections"
            className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-3 w-3" />
            Collections
          </Link>

          {editing ? (
            /* ── Edit mode ── */
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0 text-[16px] font-semibold text-foreground/50 select-none mt-0.5">
                {editName.charAt(0).toUpperCase() || collectionName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <input
                  ref={editNameRef}
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false) }}
                  className="w-full text-[17px] font-semibold text-foreground bg-transparent border-b border-border focus:outline-none focus:border-accent pb-0.5 mb-2 transition-colors"
                  placeholder="Collection name"
                />
                <textarea
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }}
                  rows={2}
                  placeholder="Description (optional)"
                  className="w-full text-[12px] text-muted-foreground bg-transparent border-b border-border/40 focus:outline-none focus:border-accent resize-none leading-relaxed pb-0.5 transition-colors"
                />
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={saveEdit}
                    disabled={!editName.trim() || savingEdit}
                    className="flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] font-medium bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors"
                  >
                    {savingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Save
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  >
                    <X className="h-3 w-3" />
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* ── Display mode ── */
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0 text-[16px] font-semibold text-foreground/50 select-none mt-0.5">
                  {collectionName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h1 className="text-[17px] font-semibold text-foreground capitalize">{collectionName}</h1>
                  {meta.description ? (
                    <p className="text-[12px] text-muted-foreground/70 mt-0.5 leading-relaxed">{meta.description}</p>
                  ) : null}
                  <p className="text-[12px] text-muted-foreground/50 mt-0.5">
                    {filtered.length} {filtered.length === 1 ? 'skill' : 'skills'}
                  </p>
                </div>
              </div>

              {/* Action row */}
              <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                <button
                  onClick={startEdit}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
                  title="Edit collection"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>

                {confirmDelete ? (
                  <div className="flex items-center gap-1 animate-in fade-in duration-100">
                    <span className="text-[11px] text-muted-foreground/70 mr-1">Delete collection?</span>
                    <button onClick={handleDeleteCollection} className="h-7 px-2.5 rounded-md text-[12px] font-medium text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors">
                      Delete
                    </button>
                    <button onClick={() => setConfirmDelete(false)} className="h-7 px-2.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors">
                      Cancel
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

                <button
                  onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90 active:scale-95 transition-all"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Skills
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Skill list ── */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6">
            <div className="w-14 h-14 rounded-2xl bg-muted/60 border border-border/40 flex items-center justify-center mb-4">
              <FolderOpen className="h-7 w-7 text-muted-foreground/30" />
            </div>
            <p className="text-[14px] font-medium text-foreground mb-1">Empty collection</p>
            <p className="text-[13px] text-muted-foreground/60 text-center max-w-[240px] mb-5 leading-relaxed">
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
                <div key={skill.slug} className="border-b border-border/30 last:border-0">
                  {isPending ? (
                    /* ── Remove confirmation row ── */
                    <div className="flex items-center justify-between px-4 py-3 bg-destructive/[0.04] animate-in fade-in duration-150">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-foreground truncate">{skill.title}</p>
                        <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                          Remove from &ldquo;{collectionName}&rdquo;?
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-4">
                        <button
                          onClick={() => setConfirmRemove(null)}
                          className="h-7 px-3 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors font-medium"
                        >
                          Keep
                        </button>
                        <button
                          onClick={() => handleRemove(skill)}
                          disabled={isRemoving}
                          className="h-7 px-3 rounded-md text-[12px] font-medium text-destructive bg-destructive/10 hover:bg-destructive/20 disabled:opacity-60 flex items-center gap-1.5 transition-colors"
                        >
                          {isRemoving && <Loader2 className="h-3 w-3 animate-spin" />}
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Normal skill row ── */
                    <div className="relative group/row flex items-center">
                      <div className="flex-1 min-w-0">
                        <SkillListItem skill={skill} />
                      </div>
                      {/* Remove button — always visible at low opacity, full on hover */}
                      <button
                        onClick={() => setConfirmRemove(skill.slug)}
                        className="shrink-0 mr-3 h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground/20 group-hover/row:text-muted-foreground/60 hover:!text-destructive hover:bg-destructive/10 transition-all duration-150"
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
          onAdded={refresh}
        />
      )}
    </>
  )
}
