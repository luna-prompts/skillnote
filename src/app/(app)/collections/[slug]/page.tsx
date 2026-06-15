'use client'
import { TopBar } from '@/components/layout/topbar'
import { SkillListItem } from '@/components/skills/skill-list-item'
import { AddSkillsModal } from '@/components/collections/AddSkillsModal'
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, FolderOpen, Info, Minus, Plus, Loader2, Pencil, Trash2, Check, X, Share2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getSkills, syncSkillsFromApi, saveSkillEdit } from '@/lib/skills-store'
import { fetchCollectionApi, fetchCollectionsApi, updateCollectionApi, deleteCollectionApi, createCollectionApi, setCollectionClaudeAiPublishApi, type CollectionListItem } from '@/lib/api/collections'
import { collectionSlug, decodeCollectionSlug } from '@/lib/derived'
import { type Skill } from '@/lib/mock-data'
import { toast } from 'sonner'
import { Connector, type ConnectionState } from '@/components/integrations/connector'
import { SkillNoteMark, ClaudeAIMark, OpenAIMark } from '@/components/integrations/agent-marks'

export default function CollectionDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  // R9 F36: SSR-safe — start empty, populate from localStorage in the effect.
  const [skills, setSkills] = useState<Skill[]>([])
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

  // API-backed collection metadata (canonical name from API overrides slug decode)
  const [apiDescription, setApiDescription] = useState('')
  const [canonicalName, setCanonicalName] = useState<string | null>(null)
  // Per-collection claude.ai publishing — banner toggle + popup confirm +
  // "flying to claude.ai" sync animation.
  const [publishedToClaudeAi, setPublishedToClaudeAi] = useState(false)
  type ModalStage = 'closed' | 'confirm' | 'syncing' | 'done'
  const [modalStage, setModalStage] = useState<ModalStage>('closed')
  const [unpublishing, setUnpublishing] = useState(false)
  // Synchronous re-entrancy guard for the publish confirm — blocks a
  // double-click on "Yes, sync" from firing two publish ops (disabled only
  // takes effect after React re-renders).
  const publishingRef = useRef(false)
  // Connectors dropdown (header "Sync" button) — lists claude.ai + future
  // connectors. Scales to N connectors without cluttering the header.
  const [syncOpen, setSyncOpen] = useState(false)
  const syncMenuRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // All collections for prev/next navigation
  const [allCollections, setAllCollections] = useState<CollectionListItem[]>([])

  // Delete state
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    // Local-first paint (R9 F36): show cached skills immediately, then refresh.
    setSkills(getSkills())
    syncSkillsFromApi().then(setSkills).catch(() => {})
    fetchCollectionsApi().then(setAllCollections).catch(() => {})
    const decodedSlug = decodeCollectionSlug(slug)
    setLoading(true)
    setNotFound(false)
    fetchCollectionApi(decodedSlug)
      .then(col => {
        setCanonicalName(col.name)
        setApiDescription(col.description || '')
        setPublishedToClaudeAi(!!col.published_to_claude_ai)
        setLoading(false)
      })
      .catch(() => {
        // Not in collections table — may be a skill-derived collection
        // Fall back to the decoded slug as the name
        setCanonicalName(null)
        setPublishedToClaudeAi(false)
        setLoading(false)
      })
  }, [slug])

  // Close the publish modal on Escape — except mid-sync, which must finish
  // (matches the app's other dialogs, which all support Escape).
  useEffect(() => {
    if (modalStage === 'closed') return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && modalStage !== 'syncing') setModalStage('closed')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalStage])

  // Close the connectors dropdown on outside-click / Escape.
  useEffect(() => {
    if (!syncOpen) return
    function onDocClick(e: MouseEvent) {
      if (syncMenuRef.current && !syncMenuRef.current.contains(e.target as Node)) {
        setSyncOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSyncOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [syncOpen])

  // Use canonical API name if available, else fall back to decoded slug
  const collectionName = canonicalName || decodeCollectionSlug(slug)

  // Nudge the connector browser extension (if installed + paired on this
  // origin) to sync NOW instead of waiting for its 1-minute alarm. The
  // extension injects a content-script bridge on this origin that relays this
  // window-message to its service worker (same effect as "Sync now" in the
  // popup). Harmless no-op when the extension isn't installed.
  function pokeExtensionSync() {
    try {
      window.postMessage({ __skillnote: 'sync-now' }, window.location.origin)
    } catch {
      /* ignore */
    }
  }

  // Toggle clicked: turning ON opens the confirm popup; turning OFF unpublishes.
  function onPublishToggle() {
    if (unpublishing || modalStage !== 'closed') return
    if (publishedToClaudeAi) void unpublish()
    else {
      setSyncOpen(false) // close the dropdown so the confirm modal is unobstructed
      setModalStage('confirm')
    }
  }

  // Confirm → run the sync (with the "flying to claude.ai" animation) → done.
  async function confirmPublish() {
    if (publishingRef.current) return // guard double-click (see publishingRef)
    publishingRef.current = true
    setModalStage('syncing')
    const started = Date.now()
    try {
      const updated = await setCollectionClaudeAiPublishApi(collectionName, true)
      pokeExtensionSync() // wake the extension to push to claude.ai immediately
      // let the animation play for a beat so it reads as a real transfer
      const elapsed = Date.now() - started
      await new Promise(r => setTimeout(r, Math.max(0, 2000 - elapsed)))
      // Trust the value the API actually persisted, not what we requested.
      setPublishedToClaudeAi(updated.published_to_claude_ai ?? true)
      // Publishing a skill-derived collection materializes a real collections
      // row server-side (the PUT upserts). Adopt its canonical name so the row
      // now exists in the UI's eyes and later edit/unpublish target it.
      setCanonicalName(updated.name)
      setModalStage('done')
    } catch (err) {
      setModalStage('closed')
      toast.error(err instanceof Error ? err.message : 'Could not publish to claude.ai')
    } finally {
      publishingRef.current = false
    }
  }

  async function unpublish() {
    setUnpublishing(true)
    try {
      const updated = await setCollectionClaudeAiPublishApi(collectionName, false)
      pokeExtensionSync() // wake the extension to retire the group on claude.ai now
      setPublishedToClaudeAi(updated.published_to_claude_ai ?? false)
      setCanonicalName(updated.name)
      toast.success(`Removed “${collectionName}” from claude.ai`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not unpublish')
    } finally {
      setUnpublishing(false)
    }
  }

  const filtered = useMemo(
    () => skills.filter(s => (s.collections || []).some(c => c.toLowerCase() === collectionName.toLowerCase())),
    [skills, collectionName]
  )

  // Prev / next collection for header navigation
  const { prevCollection, nextCollection, currentIndex } = useMemo(() => {
    if (allCollections.length <= 1) {
      return { prevCollection: null, nextCollection: null, currentIndex: -1 }
    }
    const idx = allCollections.findIndex(
      c => c.name.toLowerCase() === collectionName.toLowerCase(),
    )
    if (idx === -1) return { prevCollection: null, nextCollection: null, currentIndex: -1 }
    return {
      prevCollection: idx > 0 ? allCollections[idx - 1] : null,
      nextCollection: idx < allCollections.length - 1 ? allCollections[idx + 1] : null,
      currentIndex: idx,
    }
  }, [allCollections, collectionName])

  function refresh() {
    setSkills(getSkills())
    syncSkillsFromApi().then(setSkills).catch(() => {})
  }

  function startEdit() {
    setEditName(collectionName)
    setEditDesc(apiDescription)
    setEditing(true)
    // Focus + select so the user can immediately type over the name
    setTimeout(() => {
      editNameRef.current?.focus()
      editNameRef.current?.select()
    }, 0)
  }

  async function saveEdit() {
    const newName = editName.trim()
    if (!newName) return
    setSavingEdit(true)
    try {
      const trimmedDesc = editDesc.trim()
      if (newName.toLowerCase() !== collectionName.toLowerCase()) {
        // Rename: create new, then migrate skills, then delete old.
        // If create fails (duplicate name), abort before touching skills.
        try {
          await createCollectionApi(newName, trimmedDesc)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `Collection "${newName}" may already exist`)
          return
        }
        const allSkills = getSkills()
        for (const s of allSkills) {
          if ((s.collections || []).some(c => c.toLowerCase() === collectionName.toLowerCase())) {
            await saveSkillEdit(s.slug, {
              collections: s.collections!.map(c =>
                c.toLowerCase() === collectionName.toLowerCase() ? newName : c
              ),
            })
          }
        }
        try {
          await deleteCollectionApi(collectionName)
        } catch {}
      } else {
        // Description-only update
        try {
          await updateCollectionApi(collectionName, trimmedDesc)
        } catch {}
      }
      setApiDescription(trimmedDesc)
      toast.success('Collection updated')
      setEditing(false)
      refresh()
      if (newName.toLowerCase() !== collectionName.toLowerCase()) {
        router.replace(`/collections/${collectionSlug(newName)}`)
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
    try {
      await deleteCollectionApi(collectionName)
    } catch {}
    toast.success(`"${collectionName}" deleted`)
    router.push('/collections')
  }

  async function handleRemove(skill: Skill) {
    const wasLast = filtered.length === 1
    setRemoving(skill.slug)
    try {
      const updated = (skill.collections || []).filter(c => c.toLowerCase() !== collectionName.toLowerCase())
      await saveSkillEdit(skill.slug, { collections: updated })
      if (wasLast) {
        // Collection is now empty — offer a one-click cleanup
        toast.success(`Removed "${skill.title}" — "${collectionName}" is now empty`, {
          description: 'Delete the empty collection?',
          action: {
            label: 'Delete',
            onClick: () => { setConfirmDelete(true) },
          },
          duration: 8000,
        })
      } else {
        toast.success(`Removed from "${collectionName}"`, { description: skill.title })
      }
      setConfirmRemove(null)
      refresh()
    } catch {
      toast.error('Failed to remove skill')
    } finally {
      setRemoving(null)
    }
  }

  // Loading state — show a skeleton while the initial fetch is in flight
  if (loading) {
    return (
      <>
        <TopBar />
        <main className="flex-1 overflow-auto">
          <div className="px-6 py-5 border-b border-border/50">
            <Link
              href="/collections"
              className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors mb-4"
            >
              <ArrowLeft className="h-3 w-3" />
              Collections
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted/60 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-40 bg-muted/60 rounded animate-pulse" />
                <div className="h-3 w-24 bg-muted/40 rounded animate-pulse" />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <TopBar />
      <main className="flex-1 overflow-auto">

        {/* ── Header (sticky so Edit/Delete/Add remain accessible when scrolling) ── */}
        <div className="sticky top-0 z-10 px-6 py-5 border-b border-border/50 bg-background/95 backdrop-blur-sm">
          {/* Navigation row: back link + prev/next + position indicator */}
          <div className="flex items-center justify-between mb-4">
            <Link
              href="/collections"
              className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              Collections
            </Link>

            {currentIndex >= 0 && allCollections.length > 1 && (
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
                {prevCollection ? (
                  <Link
                    href={`/collections/${collectionSlug(prevCollection.name)}`}
                    className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted/60 hover:text-foreground transition-colors"
                    title={`Previous: ${prevCollection.name}`}
                    aria-label={`Previous collection: ${prevCollection.name}`}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Link>
                ) : (
                  <span className="h-6 w-6 flex items-center justify-center text-muted-foreground/20">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className="px-1.5 tabular-nums">
                  {currentIndex + 1} / {allCollections.length}
                </span>
                {nextCollection ? (
                  <Link
                    href={`/collections/${collectionSlug(nextCollection.name)}`}
                    className="h-6 w-6 rounded flex items-center justify-center hover:bg-muted/60 hover:text-foreground transition-colors"
                    title={`Next: ${nextCollection.name}`}
                    aria-label={`Next collection: ${nextCollection.name}`}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                ) : (
                  <span className="h-6 w-6 flex items-center justify-center text-muted-foreground/20">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
            )}
          </div>

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
                  {apiDescription ? (
                    <p className="text-[12px] text-muted-foreground/70 mt-0.5 leading-relaxed">{apiDescription}</p>
                  ) : null}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-[12px]">
                    {(() => {
                      const total = filtered.length
                      const MAX = 15
                      const over = total > MAX
                      const near = !over && total >= 12
                      return (
                        <span
                          className={cn(
                            'tabular-nums',
                            over
                              ? 'font-semibold text-destructive'
                              : near
                                ? 'font-medium text-amber-600 dark:text-amber-400'
                                : 'text-muted-foreground/60',
                          )}
                        >
                          {total} / {MAX} skills
                        </span>
                      )
                    })()}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="Why 15 skills per collection?"
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/40 hover:bg-muted hover:text-foreground"
                          >
                            <Info className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[300px] text-[11.5px] leading-relaxed">
                          Collections group skills by purpose. Each is capped at{' '}
                          <span className="font-semibold">15 skills</span>{' '}
                          so Claude Code&apos;s context stays efficient and descriptions don&apos;t get
                          truncated. Split large installs into multiple themed collections.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                  </div>

                </div>
              </div>

              {/* Action row */}
              <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                <button
                  onClick={startEdit}
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  title="Edit collection"
                  aria-label="Edit collection"
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
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    title="Delete collection"
                    aria-label="Delete collection"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}

                {/* Connectors — one "Sync" button opening a dropdown of all
                    connectors (claude.ai now, OpenAI soon, room for more).
                    Keeps the header clean and scales to N connectors. */}
                {filtered.length > 0 && (
                  <div ref={syncMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setSyncOpen(o => !o)}
                      aria-haspopup="menu"
                      aria-expanded={syncOpen}
                      title="Sync this collection to connected apps"
                      className="relative flex items-center gap-1.5 h-8 pl-2.5 pr-2 rounded-lg text-[13px] font-medium text-foreground/80 border border-border hover:bg-muted/60 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      Sync
                      {publishedToClaudeAi && (
                        <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
                      )}
                      <ChevronDown className={cn('h-3 w-3 text-muted-foreground/60 transition-transform', syncOpen && 'rotate-180')} />
                    </button>

                    {syncOpen && (
                      <div className="absolute right-0 top-full mt-1.5 z-30 w-64 rounded-xl border border-border bg-card shadow-xl p-1.5 animate-in fade-in zoom-in-95 duration-100">
                        <p className="px-2 pt-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/55">
                          Send this collection to
                        </p>

                        {/* claude.ai — live */}
                        <div className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50">
                          <span className="flex items-center gap-2 min-w-0">
                            <ClaudeAIMark size={18} />
                            <span className="min-w-0">
                              <span className="block text-[12.5px] font-medium text-foreground leading-tight">claude.ai</span>
                              <span className="block text-[10.5px] text-muted-foreground/70 leading-tight truncate">
                                {publishedToClaudeAi ? <>Live as “SkillNote: {collectionName}”</> : 'Not synced'}
                              </span>
                            </span>
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={publishedToClaudeAi}
                            aria-label={`${publishedToClaudeAi ? 'Remove from' : 'Sync to'} claude.ai`}
                            disabled={unpublishing}
                            onClick={onPublishToggle}
                            className={cn(
                              'relative inline-flex h-[18px] w-8 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                              publishedToClaudeAi ? 'bg-accent' : 'bg-border',
                              unpublishing && 'opacity-50 cursor-not-allowed',
                            )}
                          >
                            <span className={cn(
                              'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200',
                              publishedToClaudeAi ? 'translate-x-[15px]' : 'translate-x-0.5',
                            )} />
                          </button>
                        </div>

                        {/* OpenAI — coming soon */}
                        <div className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 opacity-60 select-none">
                          <span className="flex items-center gap-2 min-w-0">
                            <OpenAIMark size={18} />
                            <span className="min-w-0">
                              <span className="block text-[12.5px] font-medium text-foreground leading-tight">OpenAI</span>
                              <span className="block text-[10.5px] text-muted-foreground/70 leading-tight">Coming soon</span>
                            </span>
                          </span>
                          <span className="rounded-full bg-muted px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                            Soon
                          </span>
                        </div>

                        <p className="px-2 pt-1.5 pb-1 text-[10.5px] text-muted-foreground/45">
                          More connectors coming soon.
                        </p>
                      </div>
                    )}
                  </div>
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

      {/* ── claude.ai publish popup: confirm → flying-to-claude.ai → done ── */}
      {modalStage !== 'closed' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-150"
          onClick={() => { if (modalStage === 'confirm') setModalStage('closed') }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Sync collection to claude.ai"
            className="w-full max-w-[420px] rounded-2xl border border-border bg-card shadow-2xl p-6 break-words animate-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            {/* Brand transfer row: SkillNote collection ──wire──▶ claude.ai */}
            <div className="flex items-center gap-1">
              <div className="flex flex-col items-center gap-2 shrink-0 w-[76px]">
                <SkillNoteMark size={46} />
                <span className="text-[10.5px] font-medium text-foreground max-w-[76px] truncate capitalize">{collectionName}</span>
              </div>
              <Connector
                state={
                  (modalStage === 'syncing'
                    ? 'connecting'
                    : modalStage === 'done'
                      ? 'active'
                      : 'pending') as ConnectionState
                }
              />
              <div className="flex flex-col items-center gap-2 shrink-0 w-[76px]">
                <ClaudeAIMark size={46} />
                <span className="text-[10.5px] text-muted-foreground/80">claude.ai</span>
              </div>
            </div>

            {modalStage === 'confirm' && (
              <div className="mt-4 text-center">
                <h3 className="text-[15px] font-semibold text-foreground">
                  Sync <span className="capitalize">“{collectionName}”</span> to claude.ai?
                </h3>
                <p className="mt-1.5 text-[12.5px] text-muted-foreground leading-relaxed">
                  {filtered.length} skill{filtered.length === 1 ? '' : 's'} will appear as the{' '}
                  <span className="font-medium text-foreground">“SkillNote: {collectionName}”</span> plugin group.
                </p>
                <div className="mt-5 flex items-center gap-2">
                  <button
                    onClick={() => setModalStage('closed')}
                    className="flex-1 h-9 rounded-lg text-[13px] text-muted-foreground bg-muted/50 hover:bg-muted hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmPublish}
                    className="flex-1 h-9 rounded-lg text-[13px] font-medium bg-accent text-white hover:bg-accent/90 active:scale-95 transition-all"
                  >
                    Yes, sync
                  </button>
                </div>
              </div>
            )}

            {modalStage === 'syncing' && (
              <p className="mt-4 text-center text-[13px] font-medium text-foreground">
                Syncing to claude.ai…
              </p>
            )}

            {modalStage === 'done' && (
              <div className="mt-4">
                <h3 className="text-center text-[15px] font-semibold text-foreground">Synced to claude.ai</h3>
                <div className="mt-3 rounded-lg bg-muted/40 border border-border/50 px-3.5 py-3">
                  <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground/55 mb-1.5">
                    How to check it
                  </p>
                  <ol className="text-[11.5px] text-muted-foreground/85 leading-relaxed space-y-1 list-decimal pl-4">
                    <li>Open <a href="https://claude.ai/customize" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">claude.ai</a> → <span className="font-medium">Customize → Plugins</span></li>
                    <li>Find <span className="font-medium">“SkillNote: {collectionName}”</span> under Personal plugins</li>
                    <li>Type <span className="font-mono bg-background px-1 rounded text-[11px]">/</span> in any chat to use a skill</li>
                  </ol>
                </div>
                <button
                  onClick={() => setModalStage('closed')}
                  className="mt-4 w-full h-9 rounded-lg text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90 active:scale-95 transition-all"
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
