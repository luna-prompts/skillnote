#!/bin/bash
# SkillNote UserPromptSubmit — auto-suggest skills from user prompts.
#
# Layer A: Explicit save phrase → inject context guiding Claude through
#          the skill-push flow inline in the same turn.
# Layer B: Linguistic convention signal → write a silent draft stub to
#          .skillnote/drafts/ for the user to review later. No popup,
#          no interruption, no output.
#
# This hook MUST be synchronous so Layer A's additionalContext reaches
# Claude. Layer B is a fast file write.

# Read hook input from stdin, pass to Python via env var (safe for any JSON)
export SKILLNOTE_HOOK_INPUT
SKILLNOTE_HOOK_INPUT=$(cat)

python3 -c "
import json, os, re, sys, hashlib, datetime

try:
    d = json.loads(os.environ.get('SKILLNOTE_HOOK_INPUT', '{}'))
except Exception:
    sys.exit(0)

prompt = (d.get('prompt') or '').strip()
session_id = d.get('session_id', 'unknown')
project_dir = os.environ.get('CLAUDE_PROJECT_DIR', '.')

if not prompt or not project_dir:
    sys.exit(0)

# Only fire in projects where SkillNote is active
if not os.path.isfile(os.path.join(project_dir, '.skillnote.json')):
    sys.exit(0)

drafts_dir = os.path.join(project_dir, '.skillnote', 'drafts')
try:
    os.makedirs(drafts_dir, exist_ok=True)
except Exception:
    sys.exit(0)

now = datetime.datetime.utcnow().isoformat(timespec='seconds') + 'Z'
prompt_lower = prompt.lower()

def slugify(text, max_len=50):
    slug = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return (slug[:max_len] or 'draft').rstrip('-')

def short_hash(text):
    return hashlib.sha256(text.encode()).hexdigest()[:6]

def write_draft_once(path, body):
    # Dedupe: if a draft with the exact same content-hash already exists,
    # skip silently so repeated prompts don't spam the drafts dir.
    if os.path.exists(path):
        return
    try:
        with open(path, 'w') as f:
            f.write(body)
    except Exception:
        pass

# ─── Layer A: explicit save phrases ────────────────────────────────
LAYER_A_PATTERNS = [
    r'\bsave this as a skill\b',
    r'\bsave (it|this) as a skill\b',
    r'\bturn this into a skill\b',
    r'\bmake (this|it) a skill\b',
    r'\bsave this pattern\b',
    r'\bremember this as a (skill|convention|rule)\b',
    r'\bcreate a skill for this\b',
    r'\bpush (this|it) as a skill\b',
    r'\badd (this|it) as a skill\b',
]

for pat in LAYER_A_PATTERNS:
    if re.search(pat, prompt_lower):
        ctx = (
            'The user explicitly asked to save this as a SkillNote skill. '
            'Follow the skill-push flow: briefly confirm with the user what '
            'the skill should capture, draft the name / description / content, '
            'ask which collection it belongs to, then push via the SkillNote API. '
            'The confirmation step is REQUIRED before drafting. See the '
            'skill-push skill for the exact workflow.'
        )
        print(json.dumps({
            'hookSpecificOutput': {
                'hookEventName': 'UserPromptSubmit',
                'additionalContext': ctx
            }
        }))
        sys.exit(0)

# ─── Layer B: linguistic convention signals → silent draft ─────────
# These phrases are canonical memory markers per agent-memory literature.
# Keep the list tight to minimize false positives.
LAYER_B_PATTERNS = [
    r'\bfrom now on\b',
    r'\bgoing forward\b',
    r'\bour convention\b',
    r'\bthe rule is\b',
    r'\bfor future reference\b',
    r'\bwe (use|don\'?t use|prefer|avoid)\b',
    r'\balways (use|prefer|do|add|include|run|commit|check)\b',
    r'\bnever (use|do|add|commit|skip|bypass|push)\b',
    r'\bdon\'?t ever\b',
    r'\bremember that (we|i|this)\b',
]

for pat in LAYER_B_PATTERNS:
    m = re.search(pat, prompt_lower)
    if not m:
        continue

    # Extract the one sentence containing the matched phrase
    sentences = re.split(r'(?<=[.!?])\s+', prompt)
    matching = next(
        (s for s in sentences if re.search(pat, s.lower())),
        prompt[:240]
    ).strip()

    if len(matching) < 10:
        break  # too short to be meaningful

    slug = slugify(matching[:60])
    fname = f'{slug}-{short_hash(matching)}.md'
    path = os.path.join(drafts_dir, fname)

    body = f'''---
type: draft
trigger: linguistic_signal
signal: \"{m.group(0)}\"
created: {now}
session_id: {session_id}
status: pending
---

# Draft candidate (auto-detected)

## Evidence

At {now} the user said:

> {matching}

This contains a convention signal (\`{m.group(0)}\`) suggesting a reusable pattern worth formalizing.

## Next step

If this looks worth turning into a full skill, run \`/skillnote:skill-push\` to refine and publish it. Delete this file to dismiss the draft.
'''
    write_draft_once(path, body)
    break  # At most one draft per prompt, even if multiple signals match
" 2>/dev/null

exit 0
