# SKILL.md Validation Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align the entire SkillNote stack (frontend UI, backend API, bundle validator, exports) with the official Claude Agent Skills SKILL.md specification — enforcing name rules (64 chars, lowercase+numbers+hyphens, no reserved words, no XML), description rules (required, 1024 chars max, no XML, "what + when to use" guidance), and making the UI intuitive so users create compliant skills effortlessly.

**Architecture:** Shared validation logic lives in a frontend utility (`src/lib/skill-validation.ts`) and a mirrored backend validator (`backend/app/validators/skill_validator.py`). The NewSkillModal gets redesigned with live validation, character counters, and contextual help. The editor, exports, and bundle validator all produce/validate proper `name`+`description` YAML frontmatter. The `SKILLS.md` references throughout the UI are renamed to the correct `SKILL.md`.

**Tech Stack:** TypeScript (React 19, Next.js), Python (FastAPI, Pydantic v2), Tailwind CSS v4, Shadcn UI

---

### Task 1: Create frontend validation utility

**Files:**
- Create: `src/lib/skill-validation.ts`

**Step 1: Write the validation utility**

Create `src/lib/skill-validation.ts` with these exact functions:

```typescript
// SKILL.md spec rules from https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview

const NAME_MAX = 64
const NAME_PATTERN = /^[a-z0-9-]+$/
const RESERVED_WORDS = ['anthropic', 'claude']
const XML_TAG_RE = /<\/?[a-zA-Z][^>]*>/
const DESC_MAX = 1024

export type ValidationError = { field: string; message: string }

export function validateSkillName(name: string): ValidationError[] {
  const errors: ValidationError[] = []
  if (!name.trim()) {
    errors.push({ field: 'name', message: 'Name is required' })
    return errors
  }
  if (name.length > NAME_MAX) {
    errors.push({ field: 'name', message: `Name must be ${NAME_MAX} characters or fewer (currently ${name.length})` })
  }
  if (!NAME_PATTERN.test(name)) {
    errors.push({ field: 'name', message: 'Only lowercase letters, numbers, and hyphens allowed' })
  }
  for (const word of RESERVED_WORDS) {
    if (name.includes(word)) {
      errors.push({ field: 'name', message: `Name cannot contain reserved word "${word}"` })
    }
  }
  if (XML_TAG_RE.test(name)) {
    errors.push({ field: 'name', message: 'Name cannot contain XML tags' })
  }
  return errors
}

export function validateDescription(description: string): ValidationError[] {
  const errors: ValidationError[] = []
  if (!description.trim()) {
    errors.push({ field: 'description', message: 'Description is required' })
    return errors
  }
  if (description.length > DESC_MAX) {
    errors.push({ field: 'description', message: `Description must be ${DESC_MAX} characters or fewer (currently ${description.length})` })
  }
  if (XML_TAG_RE.test(description)) {
    errors.push({ field: 'description', message: 'Description cannot contain XML tags' })
  }
  return errors
}

export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export { NAME_MAX, DESC_MAX }
```

**Step 2: Verify the file builds**

Run: `cd /home/homeai/.openclaw-rudra/workspace/skillnote && npx tsc --noEmit src/lib/skill-validation.ts 2>&1 || echo "checking with full build..." && npm run build`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add src/lib/skill-validation.ts
git commit -m "feat: add SKILL.md validation utility with name/description rules"
```

---

### Task 2: Redesign NewSkillModal with validation

**Files:**
- Modify: `src/components/skills/NewSkillModal.tsx` (full rewrite)
- Modify: `src/lib/skills-store.ts:90-114` (use slugFromName, validate)

**Step 1: Rewrite NewSkillModal.tsx**

Replace the entire contents of `src/components/skills/NewSkillModal.tsx` with:

```typescript
'use client'
import { useState, useCallback, useEffect, KeyboardEvent } from 'react'
import { Plus, X, BookOpen, Loader2, AlertCircle, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createSkill } from '@/lib/skills-store'
import { validateSkillName, validateDescription, NAME_MAX, DESC_MAX, type ValidationError } from '@/lib/skill-validation'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

type NewSkillModalProps = {
  onClose: () => void
  collections: string[]
}

function FieldError({ errors }: { errors: ValidationError[] }) {
  if (errors.length === 0) return null
  return (
    <div className="mt-1 space-y-0.5">
      {errors.map((e, i) => (
        <p key={i} className="text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {e.message}
        </p>
      ))}
    </div>
  )
}

function CharCounter({ current, max }: { current: number; max: number }) {
  const pct = current / max
  return (
    <span className={`text-[10px] tabular-nums ${pct > 0.9 ? 'text-destructive' : pct > 0.75 ? 'text-amber-500' : 'text-muted-foreground/50'}`}>
      {current}/{max}
    </span>
  )
}

export function NewSkillModal({ onClose, collections }: NewSkillModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [selectedCollections, setSelectedCollections] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const router = useRouter()

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const nameErrors = touched.name ? validateSkillName(name) : []
  const descErrors = touched.description ? validateDescription(description) : []
  const isValid = validateSkillName(name).length === 0 && validateDescription(description).length === 0

  const addTag = useCallback(() => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTagInput('')
  }, [tagInput, tags])

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() }
    if (e.key === 'Backspace' && !tagInput && tags.length) setTags(prev => prev.slice(0, -1))
  }

  const toggleCollection = (col: string) =>
    setSelectedCollections(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col])

  const handleSubmit = useCallback(async () => {
    setTouched({ name: true, description: true })
    if (!isValid) return
    setSaving(true)
    try {
      const skill = await createSkill({
        title: name.trim(),
        description: description.trim(),
        content_md: `---\nname: ${name.trim()}\ndescription: ${description.trim()}\n---\n\n# ${name.trim()}\n\n`,
        tags,
        collections: selectedCollections,
      })
      toast.success(`Skill "${skill.title}" created`)
      onClose()
      router.push(`/skills/${skill.slug}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create skill')
    } finally {
      setSaving(false)
    }
  }, [name, description, tags, selectedCollections, isValid, router, onClose])

  // Preview slug
  const previewSlug = name.trim()
    ? name.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    : ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="new-skill-title" className="w-full max-w-lg bg-card border border-border rounded-xl shadow-2xl overflow-hidden mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
          <h3 id="new-skill-title" className="text-sm font-semibold text-foreground flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            New Skill
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px] flex items-center justify-center" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Name field */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[12px] font-medium text-foreground">Name <span className="text-destructive">*</span></label>
              <CharCounter current={name.length} max={NAME_MAX} />
            </div>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              onBlur={() => setTouched(prev => ({ ...prev, name: true }))}
              placeholder="e.g. react-hooks-guide"
              maxLength={NAME_MAX}
              className={`w-full h-9 px-3 text-[13px] font-mono bg-muted/60 border rounded-lg focus:outline-none focus:ring-1 placeholder:text-muted-foreground/60 ${
                nameErrors.length > 0 ? 'border-destructive focus:ring-destructive' : 'border-border/60 focus:ring-ring'
              }`}
            />
            <FieldError errors={nameErrors} />
            {previewSlug && nameErrors.length === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Slug: <code className="font-mono">{previewSlug}</code>
              </p>
            )}
            <p className="mt-1 text-[10px] text-muted-foreground/50">
              Lowercase letters, numbers, and hyphens only. Max {NAME_MAX} chars.
            </p>
          </div>

          {/* Description field */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[12px] font-medium text-foreground">Description <span className="text-destructive">*</span></label>
              <CharCounter current={description.length} max={DESC_MAX} />
            </div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={() => setTouched(prev => ({ ...prev, description: true }))}
              placeholder="Describe what this skill does AND when Claude should use it. Be specific — e.g. &quot;Use whenever the user mentions PDFs, forms, document extraction, or any file-processing task.&quot;"
              maxLength={DESC_MAX}
              rows={3}
              className={`w-full px-3 py-2 text-[13px] bg-muted/60 border rounded-lg focus:outline-none focus:ring-1 placeholder:text-muted-foreground/60 resize-none ${
                descErrors.length > 0 ? 'border-destructive focus:ring-destructive' : 'border-border/60 focus:ring-ring'
              }`}
            />
            <FieldError errors={descErrors} />
            <div className="mt-1.5 flex items-start gap-1.5 p-2 bg-blue-500/5 border border-blue-500/10 rounded-lg">
              <Info className="h-3 w-3 text-blue-500 mt-0.5 shrink-0" />
              <p className="text-[10px] text-blue-600 dark:text-blue-400 leading-relaxed">
                Include both <strong>what</strong> the skill does and <strong>when</strong> Claude should use it. Be pushy — Claude tends to under-trigger. Example: <em>"Extract text and tables from PDF files. Use whenever the user mentions PDFs, forms, or document extraction."</em>
              </p>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1.5">Tags</label>
            <div className="flex flex-wrap gap-1.5 p-2 bg-muted/60 border border-border/60 rounded-lg min-h-[36px]">
              {tags.map(tag => (
                <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent text-[11px] font-mono rounded-md">
                  {tag}
                  <button onClick={() => setTags(prev => prev.filter(t => t !== tag))} className="hover:opacity-70"><X className="h-2.5 w-2.5" /></button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
                placeholder={tags.length === 0 ? 'type tag + Enter' : ''}
                className="flex-1 min-w-[80px] bg-transparent text-[12px] font-mono focus:outline-none placeholder:text-muted-foreground/50"
              />
            </div>
          </div>

          {/* Collections */}
          {collections.length > 0 && (
            <div>
              <label className="block text-[12px] font-medium text-foreground mb-1.5">Collection</label>
              <div className="flex flex-wrap gap-1.5">
                {collections.map(col => (
                  <button
                    key={col}
                    onClick={() => toggleCollection(col)}
                    className={`px-2.5 py-1 rounded-lg text-[12px] border transition-colors ${
                      selectedCollections.includes(col)
                        ? 'bg-accent/10 text-accent border-accent/30'
                        : 'bg-muted text-muted-foreground border-border/60 hover:text-foreground'
                    }`}
                  >
                    {col}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border/60 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="h-8 text-[13px]" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            className="h-8 text-[13px] gap-1.5 bg-foreground text-background hover:bg-foreground/90"
            disabled={!isValid || saving}
            onClick={handleSubmit}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create Skill
          </Button>
        </div>
      </div>
    </div>
  )
}
```

Key changes from original:
- "Title" field → "Name" field with **auto-enforce** (`onChange` strips non-compliant chars live)
- Name gets `font-mono` styling and slug preview
- Description changed from `<input>` to `<textarea>` (3 rows) with char counter
- Description marked as required (`*`) — was optional before
- Blue info box with "what + when" guidance
- `FieldError` component shows validation errors inline
- `CharCounter` component with color-coded limits
- `content_md` now includes proper `---\nname: ...\ndescription: ...\n---` YAML frontmatter
- Placeholder changed from "React Hooks Guide" to "react-hooks-guide" (lowercase)

**Step 2: Update skills-store.ts to use slugFromName**

In `src/lib/skills-store.ts`, replace lines 90-114 (the `createSkill` function):

Change the slug generation at lines 97-102 from:
```typescript
  const slug = data.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
```

To:
```typescript
  const { slugFromName } = await import('./skill-validation')
  const slug = slugFromName(data.title)
```

Note: Use dynamic import to avoid circular deps or module loading issues with 'use client'. Alternatively, just import at top of file:
```typescript
import { slugFromName } from './skill-validation'
```
Then use `slugFromName(data.title)` in place of the inline slug logic.

**Step 3: Verify build**

Run: `cd /home/homeai/.openclaw-rudra/workspace/skillnote && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/skills/NewSkillModal.tsx src/lib/skills-store.ts
git commit -m "feat: redesign NewSkillModal with SKILL.md validation rules"
```

---

### Task 3: Fix SKILL.md references in UI (was "SKILLS.md")

**Files:**
- Modify: `src/components/skills/tabs/SkillEditTab.tsx:101,124`
- Modify: `src/components/skills/skill-detail.tsx:302`

**Step 1: Fix SkillEditTab.tsx**

In `src/components/skills/tabs/SkillEditTab.tsx`, change line 101:
```
<span className="font-mono text-[12px] text-muted-foreground/50 shrink-0">SKILLS.md</span>
```
To:
```
<span className="font-mono text-[12px] text-muted-foreground/50 shrink-0">SKILL.md</span>
```

And line 124:
```
<span className="font-mono text-[13px] text-muted-foreground shrink-0">SKILLS.md</span>
```
To:
```
<span className="font-mono text-[13px] text-muted-foreground shrink-0">SKILL.md</span>
```

**Step 2: Fix skill-detail.tsx**

In `src/components/skills/skill-detail.tsx`, change line 302:
```
<code className="font-mono text-[11px] text-muted-foreground/50 tracking-wide">{skill.slug.replace(/-/g, '_')}/SKILLS.md</code>
```
To:
```
<code className="font-mono text-[11px] text-muted-foreground/50 tracking-wide">{skill.slug}/SKILL.md</code>
```

Note: Also removed the `.replace(/-/g, '_')` — skill slugs should stay as-is (hyphens are correct per spec).

**Step 3: Verify build**

Run: `cd /home/homeai/.openclaw-rudra/workspace/skillnote && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/skills/tabs/SkillEditTab.tsx src/components/skills/skill-detail.tsx
git commit -m "fix: rename SKILLS.md to SKILL.md throughout UI"
```

---

### Task 4: Fix markdown export to use name+description frontmatter

**Files:**
- Modify: `src/lib/markdown-utils.ts:3-13`
- Modify: `src/lib/export-utils.ts` (no changes needed if markdown-utils is fixed)

**Step 1: Fix generateMarkdown**

In `src/lib/markdown-utils.ts`, replace the `generateMarkdown` function (lines 3-13):

```typescript
export function generateMarkdown(skill: Skill): string {
  const frontmatter = [
    '---',
    `name: ${skill.slug}`,
    `description: ${skill.description}`,
    '---',
    '',
  ].join('\n')
  return frontmatter + skill.content_md
}
```

Key change: Uses `name` (the slug, which is the spec-compliant lowercase-hyphenated name) and `description` instead of `title`/`tags`/`created`. The `name` field per spec is the lowercase-hyphen identifier, which maps to our `slug`.

**Step 2: Fix parseMarkdown**

In `src/lib/markdown-utils.ts`, update the `parseMarkdown` function (lines 15-59) to understand both `name` and `title` frontmatter:

Replace lines 26-28:
```typescript
    const titleMatch = fm.match(/^title:\s*(.+)$/m)
    if (titleMatch) title = titleMatch[1].trim()
```

With:
```typescript
    // Support both "name" (SKILL.md spec) and "title" (legacy) frontmatter
    const nameMatch = fm.match(/^name:\s*(.+)$/m)
    if (nameMatch) title = nameMatch[1].trim()
    const titleMatch = fm.match(/^title:\s*(.+)$/m)
    if (titleMatch && !nameMatch) title = titleMatch[1].trim()
```

**Step 3: Verify build**

Run: `cd /home/homeai/.openclaw-rudra/workspace/skillnote && npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/lib/markdown-utils.ts
git commit -m "fix: export SKILL.md with name+description frontmatter per spec"
```

---

### Task 5: Add description editing to skill detail page

**Files:**
- Modify: `src/components/skills/skill-detail.tsx`

The skill detail page currently has a title input but no way to edit the description inline. Since description is now required, we need to:

**Step 1: Add description state and validation to skill-detail.tsx**

In `src/components/skills/skill-detail.tsx`, add the import at the top (line 1-16 area):

After the existing imports, add:
```typescript
import { validateSkillName, validateDescription } from '@/lib/skill-validation'
```

Add description state next to titleValue (around line 115):
```typescript
const [descriptionValue, setDescriptionValue] = useState(skill.description)
```

**Step 2: Add description display in the header**

In `src/components/skills/skill-detail.tsx`, after the tags section (around line 320, after the closing `</div>` of the tags flex container), add a description paragraph. Find the line:
```tsx
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {skill.tags.map(tag => (
```

Before it, insert:
```tsx
                {skill.description && (
                  <p className="text-[12px] text-muted-foreground/70 mt-1.5 leading-relaxed max-w-xl">
                    {skill.description}
                  </p>
                )}
```

**Step 3: Pass description to saveSkillEdit**

Update the `handleSave` callback (around line 185):

Change:
```typescript
      await saveSkillEdit(skill.slug, { title: titleValue, content_md: editorContent })
```
To:
```typescript
      await saveSkillEdit(skill.slug, { title: titleValue, description: descriptionValue, content_md: editorContent })
```

**Step 4: Update saveSkillEdit signature in skills-store.ts**

In `src/lib/skills-store.ts`, update the `saveSkillEdit` function (line 123) to include description:

Change:
```typescript
export async function saveSkillEdit(slug: string, patch: { title?: string; content_md?: string; tags?: string[]; collections?: string[] }): Promise<void> {
```
To:
```typescript
export async function saveSkillEdit(slug: string, patch: { title?: string; description?: string; content_md?: string; tags?: string[]; collections?: string[] }): Promise<void> {
```

And update the API call (line 125):
```typescript
    await updateSkillApi(slug, { name: patch.title, description: patch.description, content_md: patch.content_md, tags: patch.tags, collections: patch.collections })
```

**Step 5: Verify build**

Run: `cd /home/homeai/.openclaw-rudra/workspace/skillnote && npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/components/skills/skill-detail.tsx src/lib/skills-store.ts
git commit -m "feat: show description on skill detail, pass to save"
```

---

### Task 6: Backend validation — Pydantic schemas

**Files:**
- Create: `backend/app/validators/skill_validator.py`
- Modify: `backend/app/schemas/skill.py`

**Step 1: Create backend skill validator**

Create `backend/app/validators/skill_validator.py`:

```python
import re

NAME_MAX = 64
DESC_MAX = 1024
NAME_PATTERN = re.compile(r"^[a-z0-9-]+$")
XML_TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")
RESERVED_WORDS = ["anthropic", "claude"]


def validate_skill_name(name: str) -> list[str]:
    errors: list[str] = []
    name = name.strip()
    if not name:
        errors.append("Name is required")
        return errors
    if len(name) > NAME_MAX:
        errors.append(f"Name must be {NAME_MAX} characters or fewer")
    if not NAME_PATTERN.match(name):
        errors.append("Name must contain only lowercase letters, numbers, and hyphens")
    for word in RESERVED_WORDS:
        if word in name:
            errors.append(f'Name cannot contain reserved word "{word}"')
    if XML_TAG_RE.search(name):
        errors.append("Name cannot contain XML tags")
    return errors


def validate_skill_description(description: str) -> list[str]:
    errors: list[str] = []
    description = description.strip()
    if not description:
        errors.append("Description is required")
        return errors
    if len(description) > DESC_MAX:
        errors.append(f"Description must be {DESC_MAX} characters or fewer")
    if XML_TAG_RE.search(description):
        errors.append("Description cannot contain XML tags")
    return errors
```

**Step 2: Add Pydantic validators to schemas**

Replace `backend/app/schemas/skill.py` with:

```python
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, field_validator
import uuid

from app.validators.skill_validator import validate_skill_name, validate_skill_description


class SkillListItem(BaseModel):
    name: str
    slug: str
    description: str
    tags: List[str] = []
    collections: List[str] = []
    latestVersion: Optional[str] = None
    status: Optional[str] = None
    channel: Optional[str] = None


class SkillDetail(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    description: str
    content_md: Optional[str] = ""
    tags: List[str] = []
    collections: List[str] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SkillCreate(BaseModel):
    name: str
    slug: str
    description: str
    content_md: str = ""
    tags: List[str] = []
    collections: List[str] = []

    @field_validator("name")
    @classmethod
    def check_name(cls, v: str) -> str:
        errors = validate_skill_name(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v.strip()

    @field_validator("description")
    @classmethod
    def check_description(cls, v: str) -> str:
        errors = validate_skill_description(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v.strip()


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    content_md: Optional[str] = None
    tags: Optional[List[str]] = None
    collections: Optional[List[str]] = None

    @field_validator("name")
    @classmethod
    def check_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        errors = validate_skill_name(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v.strip()

    @field_validator("description")
    @classmethod
    def check_description(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        errors = validate_skill_description(v)
        if errors:
            raise ValueError("; ".join(errors))
        return v.strip()
```

**Step 3: Deploy to backend container**

```bash
docker cp backend/app/validators/skill_validator.py backend-api-1:/app/app/validators/skill_validator.py
docker cp backend/app/schemas/skill.py backend-api-1:/app/app/schemas/skill.py
docker restart backend-api-1
```

Wait 5 seconds, then test:
```bash
# Test valid name — should succeed
curl -s -X POST http://localhost:8082/v1/skills \
  -H "Authorization: Bearer skn_dev_demo_token" \
  -H "Content-Type: application/json" \
  -d '{"name":"test-valid-skill","slug":"test-valid-skill","description":"A test skill. Use when testing validation."}' | head -c 200

# Test invalid name (has uppercase) — should fail with 422
curl -s -X POST http://localhost:8082/v1/skills \
  -H "Authorization: Bearer skn_dev_demo_token" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Invalid","slug":"test-invalid","description":"desc"}' | head -c 200

# Test reserved word — should fail
curl -s -X POST http://localhost:8082/v1/skills \
  -H "Authorization: Bearer skn_dev_demo_token" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-claude-skill","slug":"my-claude-skill","description":"test"}' | head -c 200

# Clean up test skill
curl -s -X DELETE http://localhost:8082/v1/skills/test-valid-skill \
  -H "Authorization: Bearer skn_dev_demo_token"
```

**Step 4: Commit**

```bash
git add backend/app/validators/skill_validator.py backend/app/schemas/skill.py
git commit -m "feat: add SKILL.md name/description validation to backend"
```

---

### Task 7: Enhance bundle validator with full SKILL.md rules

**Files:**
- Modify: `backend/app/validators/bundle_validator.py:46-54`

**Step 1: Update bundle_validator.py**

In `backend/app/validators/bundle_validator.py`, replace lines 46-54 (the frontmatter validation section):

```python
    frontmatter = yaml.safe_load(m.group(1)) or {}
    name = (frontmatter.get("name") or "").strip()
    description = (frontmatter.get("description") or "").strip()
    if not name or not description:
        raise ValueError("Frontmatter requires name and description")

    slug = slugify(name)
    if not slug:
        raise ValueError("Unable to derive slug from skill name")
```

With:

```python
    frontmatter = yaml.safe_load(m.group(1)) or {}
    name = (frontmatter.get("name") or "").strip()
    description = (frontmatter.get("description") or "").strip()

    from app.validators.skill_validator import validate_skill_name, validate_skill_description
    name_errors = validate_skill_name(name)
    if name_errors:
        raise ValueError(f"Invalid skill name: {'; '.join(name_errors)}")

    desc_errors = validate_skill_description(description)
    if desc_errors:
        raise ValueError(f"Invalid skill description: {'; '.join(desc_errors)}")

    slug = slugify(name)
    if not slug:
        raise ValueError("Unable to derive slug from skill name")
```

**Step 2: Deploy and test**

```bash
docker cp backend/app/validators/bundle_validator.py backend-api-1:/app/app/validators/bundle_validator.py
docker restart backend-api-1
```

**Step 3: Commit**

```bash
git add backend/app/validators/bundle_validator.py
git commit -m "feat: enforce SKILL.md spec rules in bundle validator"
```

---

### Task 8: Add description to SkillEditTab editor

**Files:**
- Modify: `src/components/skills/tabs/SkillEditTab.tsx`

Currently the SkillEditTab only shows a title input. Add a description textarea with validation below the title when in fullscreen editing mode.

**Step 1: Update SkillEditTab props and UI**

In `src/components/skills/tabs/SkillEditTab.tsx`, add description props to the type (line 7-17):

Change:
```typescript
type SkillEditTabProps = {
  editorContent: string
  setEditorContent: (content: string) => void
  editorDirty: boolean
  onDiscard: () => void
  onSave: () => void
  onCancel: () => void
  skillTitle: string
  setSkillTitle: (title: string) => void
  openFullscreen?: boolean
}
```

To:
```typescript
type SkillEditTabProps = {
  editorContent: string
  setEditorContent: (content: string) => void
  editorDirty: boolean
  onDiscard: () => void
  onSave: () => void
  onCancel: () => void
  skillTitle: string
  setSkillTitle: (title: string) => void
  skillDescription: string
  setSkillDescription: (desc: string) => void
  openFullscreen?: boolean
}
```

Update the function signature (line 19):
```typescript
export function SkillEditTab({ editorContent, setEditorContent, editorDirty, onDiscard, onSave, onCancel, skillTitle, setSkillTitle, skillDescription, setSkillDescription, openFullscreen }: SkillEditTabProps) {
```

Add imports at top:
```typescript
import { validateDescription, DESC_MAX } from '@/lib/skill-validation'
```

In the fullscreen header section (around lines 87-96), after the title input, add the description textarea:

After the `<input>` for title and the dirty indicator span, but still inside the header div, add:
```tsx
          {/* Description input */}
          <div className="px-6 sm:px-10 pb-3 shrink-0">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-medium text-muted-foreground/60">Description</label>
              <span className={`text-[10px] tabular-nums ${skillDescription.length > DESC_MAX * 0.9 ? 'text-destructive' : 'text-muted-foreground/40'}`}>
                {skillDescription.length}/{DESC_MAX}
              </span>
            </div>
            <textarea
              value={skillDescription}
              onChange={(e) => setSkillDescription(e.target.value)}
              placeholder="What this skill does and when Claude should use it..."
              rows={2}
              maxLength={DESC_MAX}
              className="w-full px-3 py-2 text-[13px] bg-muted/40 border border-border/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30 resize-none"
            />
          </div>
```

**Step 2: Update skill-detail.tsx to pass description props**

In `src/components/skills/skill-detail.tsx`, where SkillEditTab is used (around line 427):

Change:
```tsx
              <SkillEditTab
                editorContent={editorContent}
                setEditorContent={setEditorContent}
                editorDirty={editorDirty}
                onDiscard={handleDiscard}
                onSave={handleSave}
                onCancel={handleCancel}
                skillTitle={titleValue}
                setSkillTitle={setTitleValue}
                openFullscreen={true}
              />
```

To:
```tsx
              <SkillEditTab
                editorContent={editorContent}
                setEditorContent={setEditorContent}
                editorDirty={editorDirty}
                onDiscard={handleDiscard}
                onSave={handleSave}
                onCancel={handleCancel}
                skillTitle={titleValue}
                setSkillTitle={setTitleValue}
                skillDescription={descriptionValue}
                setSkillDescription={setDescriptionValue}
                openFullscreen={true}
              />
```

**Step 3: Update editorDirty to include description**

In `src/components/skills/skill-detail.tsx`, change line 154:

From:
```typescript
  const editorDirty = editorContent !== skill.content_md
```

To:
```typescript
  const editorDirty = editorContent !== skill.content_md || titleValue !== skill.title || descriptionValue !== skill.description
```

**Step 4: Verify build**

Run: `cd /home/homeai/.openclaw-rudra/workspace/skillnote && npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/components/skills/tabs/SkillEditTab.tsx src/components/skills/skill-detail.tsx
git commit -m "feat: add description editing to skill editor with validation"
```

---

### Task 9: End-to-end verification

**Step 1: Verify frontend builds and serves**

```bash
cd /home/homeai/.openclaw-rudra/workspace/skillnote && npm run build
```

**Step 2: Test backend validation via API**

```bash
# Test name too long (>64 chars)
curl -s -X POST http://localhost:8082/v1/skills \
  -H "Authorization: Bearer skn_dev_demo_token" \
  -H "Content-Type: application/json" \
  -d '{"name":"this-name-is-way-too-long-and-exceeds-the-sixty-four-character-limit-that-is-imposed","slug":"too-long","description":"Valid description for testing."}' | python3 -m json.tool

# Test empty description
curl -s -X POST http://localhost:8082/v1/skills \
  -H "Authorization: Bearer skn_dev_demo_token" \
  -H "Content-Type: application/json" \
  -d '{"name":"valid-name","slug":"valid-name","description":""}' | python3 -m json.tool

# Test XML tags in name
curl -s -X POST http://localhost:8082/v1/skills \
  -H "Authorization: Bearer skn_dev_demo_token" \
  -H "Content-Type: application/json" \
  -d '{"name":"<script>bad</script>","slug":"bad","description":"Valid."}' | python3 -m json.tool

# Test reserved word "claude"
curl -s -X POST http://localhost:8082/v1/skills \
  -H "Authorization: Bearer skn_dev_demo_token" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-claude-helper","slug":"my-claude-helper","description":"Valid description."}' | python3 -m json.tool

# Test valid create
curl -s -X POST http://localhost:8082/v1/skills \
  -H "Authorization: Bearer skn_dev_demo_token" \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e-test-skill","slug":"e2e-test-skill","description":"A test skill for validation. Use whenever you need to verify e2e flows."}' | python3 -m json.tool

# Clean up
curl -s -X DELETE http://localhost:8082/v1/skills/e2e-test-skill \
  -H "Authorization: Bearer skn_dev_demo_token"
```

Expected:
- First 4 requests: 422 with validation error messages
- 5th request: 201 with valid skill
- Delete: 204

**Step 3: Visual test in browser**

Open http://localhost:3000, press N to open New Skill modal:
- Verify "Name" field auto-converts to lowercase, strips non-compliant chars
- Verify character counter on name (shows /64)
- Verify "Description" is required with `*`
- Verify blue info box with "what + when" guidance
- Verify character counter on description (shows /1024)
- Verify slug preview below name
- Try creating with empty description — should show error
- Try creating with valid data — should succeed

**Step 4: Commit final state**

If any fixes were needed, commit them:
```bash
git add -A && git commit -m "fix: e2e validation alignment fixes"
```
