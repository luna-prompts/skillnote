#!/bin/bash
# SkillNote Sync (Codex) — SessionStart hook (also run by auto-sync.sh and the
# codex() wrapper). Syncs the active collection's skills into PROJECT/.codex/
# skills/ with full frontmatter, tracking create/update/delete via a manifest.
# Offline-first (silent fail using cached skills). Codex runs hooks with the
# session cwd as the working directory, so PROJECT_DIR is $PWD.
#
# SECURITY: all untrusted values (collection names from .skillnote.json, skill
# slugs/content from the API, filesystem paths) are passed to Python via the
# environment and read with os.environ — NEVER string-interpolated into Python
# source. A .skillnote.json can ride along in a cloned repo, so a naive
# interpolation would be remote code execution at SessionStart.

export PYTHONIOENCODING=utf-8

# ── output mode ──────────────────────────────────────────────────────────────
# tty  — a human is watching (codex() wrapper / manual run): branded ANSI box,
#        offline notice on stderr, exit 3 when offline.
# prog — invoked by another SkillNote script (SKILLNOTE_CALLER set): plain
#        one-line change summary on stdout, exit 3 when offline.
# hook — Codex is invoking us directly as a SessionStart handler. Codex treats
#        ANY non-zero exit as a failed hook (red error in the TUI) and injects
#        plain stdout into the model context verbatim — so in hook mode we are
#        always silent on stdout and always exit 0. Codex advertises the synced
#        skills to the model natively; no context injection is needed here.
if [ -t 0 ]; then MODE=tty
elif [ -n "$SKILLNOTE_CALLER" ]; then MODE=prog
else MODE=hook; fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Prefer the full base URL the installer recorded: a self-hosted SkillNote may
# be behind HTTPS, a reverse proxy, or a non-default port, and rebuilding
# "http://<host>:8082" from a bare hostname would silently point every request
# at a dead endpoint. Fall back to the legacy host file for installs that
# predate api-url.
API_URL=""
if [ -r "$HOME/.skillnote/api-url" ]; then
    API_URL=$(head -n 1 "$HOME/.skillnote/api-url" 2>/dev/null | tr -d ' \t\r\n')
fi
case "$API_URL" in
    http://*|https://*) ;;
    *) HOST=$("$SCRIPT_DIR/resolve-host.sh"); API_URL="http://${HOST}:8082" ;;
esac
API_URL="${API_URL%/}"
PROJECT_DIR="${PWD:-.}"
CONFIG_PATH="${PROJECT_DIR}/.skillnote.json"

# No .skillnote.json = no sync. The collection picker must run first.
[ -f "$CONFIG_PATH" ] || exit 0

SKILLS_DIR="${PROJECT_DIR}/.codex/skills"
# Manifest, lock, and throttle live in the PER-PROJECT skills dir — never in the
# global $PLUGIN_DATA. A global lock/throttle would let one project's sync
# starve another's (the "another sync covers us" invariant only holds per
# project), and a global manifest would thrash across projects.
MANIFEST_DIR="$SKILLS_DIR"
MANIFEST="${MANIFEST_DIR}/.skillnote-manifest.json"

# ── determine active collections (config path via env; validated) ────────────
COLLECTIONS=$(CONFIG_PATH="$CONFIG_PATH" python3 - <<'PY'
import json, os, re, sys
try:
    cfg = json.load(open(os.environ["CONFIG_PATH"], encoding="utf-8"))
except Exception:
    print("__ERROR__"); sys.exit(0)
cols = cfg.get("collections", [])
# "*" anywhere means "all collections" — ["*", "x"] must widen to all, not be
# rejected as invalid by the name pattern below.
if cols == "*" or (isinstance(cols, list) and "*" in cols):
    print("__ALL__"); sys.exit(0)
if not isinstance(cols, list) or not all(isinstance(c, str) for c in cols):
    print("__ERROR__"); sys.exit(0)
# Mirror the backend collection-name rule; reject anything path-hostile.
pat = re.compile(r"^[a-z0-9_-]+$")
if not all(pat.match(c) for c in cols):
    print("__ERROR__"); sys.exit(0)
print("__NONE__" if not cols else ",".join(cols))
PY
)

# ── no-op exit ───────────────────────────────────────────────────────────────
# prog callers (auto-sync) must distinguish "synced successfully" (0) from
# "did nothing this run" (4) so the throttle only advances after a real sync —
# a lock collision with the SessionStart sync must not stamp the throttle when
# that covering sync may itself fail. tty/hook modes stay exit 0.
bail_noop() {
    [ "$MODE" = prog ] && exit 4
    exit 0
}

case "$COLLECTIONS" in
    # Nothing was synced in either case, so prog callers must not stamp the
    # throttle — an unfixable config shouldn't look like a successful sync.
    __ERROR__) echo "SkillNote: invalid .skillnote.json" >&2; bail_noop ;;
    __NONE__)  bail_noop ;;
    __ALL__)   COLLECTIONS="" ;;
esac

# ── build fetch URL (URL-encode the filter via env, not interpolation) ───────
# include=content asks the registry to embed each SKILL.md body. The default
# list response omits bodies (the web app caches it in localStorage), and
# without this every file we write would be a frontmatter-only stub.
if [ -n "$COLLECTIONS" ]; then
    ENCODED=$(COLLECTIONS="$COLLECTIONS" python3 -c 'import os,urllib.parse; print(urllib.parse.quote(os.environ["COLLECTIONS"]))')
    FETCH_URL="${API_URL}/v1/skills?include=content&collections=${ENCODED}"
else
    FETCH_URL="${API_URL}/v1/skills?include=content"
fi

mkdir -p "$SKILLS_DIR" "$MANIFEST_DIR"

# ── single-writer lock (portable mkdir lock + stale reap) ────────────────────
# SessionStart, the codex() wrapper, and auto-sync can all fire concurrently on
# one project. Serialize them so the manifest and SKILL.md files never interleave.
LOCK="${MANIFEST_DIR}/.skillnote-sync.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
    # Steal the lock only if it's stale (owner crashed >2min ago). The steal
    # is a rename, not rmdir+mkdir: renaming is atomic, so of two racers that
    # both see the same stale lock exactly one succeeds — with rmdir+mkdir
    # both could end up "holding" it and interleave writes, which is the
    # corruption this lock exists to prevent.
    if [ -z "$(find "$LOCK" -maxdepth 0 -mmin -2 2>/dev/null)" ]; then
        REAPED="${LOCK}.reap.$$"
        if mv "$LOCK" "$REAPED" 2>/dev/null; then
            rmdir "$REAPED" 2>/dev/null || true
            mkdir "$LOCK" 2>/dev/null || bail_noop
        else
            bail_noop  # lost the race to reap; the winner is syncing
        fi
    else
        bail_noop  # another sync (this project) in progress — don't stamp for it
    fi
fi
# EXIT frees the lock on any normal path; INT/TERM (hook-timeout kill) also
# stop the script — without the exit, a caught signal would release the lock
# and then keep writing into .codex/skills unlocked.
cleanup() { rmdir "$LOCK" 2>/dev/null || true; }
trap cleanup EXIT
trap 'cleanup; trap - EXIT; exit 0' INT TERM

# ── fetch skills (curl gives us clean offline detection) ─────────────────────
# Offline uses a distinct exit code (3) in tty/prog mode so auto-sync can gate
# on the code instead of scraping user-controlled stdout (a collection literally
# named "offline" must not change control flow). In hook mode a non-zero exit
# would render as a failed hook in the Codex TUI on every session start while
# the server is down — so hook mode swallows offline as a silent success.
SKILLS=$(curl -sf --connect-timeout 5 --max-time 10 "$FETCH_URL" 2>/dev/null) || {
    echo "SkillNote: offline (using cached skills)" >&2
    [ "$MODE" = hook ] && exit 0
    exit 3
}

# ── sync: create/update/delete, manifest, branded summary ────────────────────
# Everything the Python needs comes from the environment (never interpolated).
# The skills JSON is passed via a temp file — a heredoc program (python3 - <<PY)
# already occupies stdin, so we can't also pipe data in.
SKILLS_FILE=$(mktemp -t skillnote-skills.XXXXXX.json) || bail_noop
printf '%s' "$SKILLS" > "$SKILLS_FILE"
cleanup() { rmdir "$LOCK" 2>/dev/null || true; rm -f "$SKILLS_FILE"; }

RESULT=$(SKILLS_DIR="$SKILLS_DIR" MANIFEST="$MANIFEST" \
    COLLECTIONS="$COLLECTIONS" API_URL="$API_URL" SKILLS_FILE="$SKILLS_FILE" \
    SKILLNOTE_MODE="$MODE" \
    python3 - <<'PY'
import json, os, re, sys, shutil

skills_dir = os.environ["SKILLS_DIR"]
manifest_path = os.environ["MANIFEST"]
collections_env = os.environ.get("COLLECTIONS", "")
api_url = os.environ.get("API_URL", "http://localhost:8082")

# Skills the plugin already ships as bundled skills — don't duplicate.
plugin_provided = {"skill-push", "collection", "complete-skill", "skillnote"}

# A slug must match the backend rule exactly. This is the traversal guard:
# the pattern admits no "/", "\\", "." or ".." so a synced/deleted name can
# never escape skills_dir.
SLUG_RE = re.compile(r"^[a-z0-9_-]+(?::[a-z0-9_-]+)?$")
NAME_RE = re.compile(r"^skillnote-[a-z0-9_-]+(?::[a-z0-9_-]+)?$")

base_real = os.path.realpath(skills_dir)


def contained(path):
    """Belt-and-suspenders: reject any path that escapes skills_dir."""
    full = os.path.realpath(path)
    return full == base_real or full.startswith(base_real + os.sep)


def atomic_write(path, text):
    # encoding is explicit: frontmatter uses ensure_ascii=False and bodies are
    # written verbatim, so under a C/POSIX locale a default-encoding open() would
    # raise UnicodeEncodeError on any non-ASCII char and abort the whole sync.
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


# Keys the registry owns; free-form extras must never redefine them.
RESERVED_FM_KEYS = ("name", "description", "collections")
KEY_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def safe_extra_frontmatter(raw):
    """Render a skill's free-form extra frontmatter as safe `key: value` lines.

    The value is authored upstream (imported skills carry whatever their
    author wrote), so appending it verbatim would let it close the
    frontmatter early with a `---` fence and inject arbitrary text into the
    document body the agent reads, or redeclare `name` so the skill shadows
    another one. Parse it, keep only a top-level mapping, drop reserved
    keys, and re-emit through the JSON encoder (JSON is valid YAML).
    PyYAML isn't guaranteed present in the user's python3, so fall back to a
    conservative line parser that accepts only simple scalars.
    """
    if not isinstance(raw, str) or not raw.strip():
        return []
    parsed = None
    try:
        import yaml  # noqa: PLC0415 — optional, resolved per call
        parsed = yaml.safe_load(raw)
    except ImportError:
        parsed = {}
        for line in raw.splitlines():
            if not line.strip() or line.lstrip() != line or ":" not in line:
                continue  # blank, nested, or not a key: value line
            key, _, value = line.partition(":")
            parsed[key.strip()] = value.strip()
    except Exception:
        return []
    if not isinstance(parsed, dict):
        return []

    out = []
    for key, value in parsed.items():
        if not isinstance(key, str):
            continue
        key = key.strip()
        if not key or key.lower() in RESERVED_FM_KEYS or not KEY_RE.match(key):
            continue
        try:
            encoded = json.dumps(value, ensure_ascii=False, default=str)
        except (TypeError, ValueError):
            encoded = json.dumps(str(value), ensure_ascii=False)
        out.append(f"{key}: {encoded}")
    return out


try:
    with open(os.environ["SKILLS_FILE"], encoding="utf-8") as f:
        skills = json.load(f)
    if not isinstance(skills, list):
        raise ValueError("skills payload is not a list")
except Exception:
    # exit 4 = "did nothing" — sync.sh maps it to a prog no-op so auto-sync
    # doesn't stamp its throttle; tty/hook still resolve to exit 0.
    print("SkillNote: unexpected server response (keeping cached skills)", file=sys.stderr)
    sys.exit(4)

# Load existing manifest (validate every entry before we ever delete by it).
old_managed = set()
if os.path.exists(manifest_path):
    try:
        with open(manifest_path, encoding="utf-8") as f:
            for n in json.load(f).get("skills", []):
                if isinstance(n, str) and NAME_RE.match(n):
                    old_managed.add(n)
    except Exception:
        old_managed = set()

# Safety: an empty response with cached skills present = keep them. This guards
# BOTH a filtered "collection not found" AND an unfiltered ("*") transient empty
# 200 — without the unfiltered guard, a momentary server glitch would delete
# every synced skill for "*" users.
if not skills and old_managed:
    print("SkillNote: empty response from server (keeping cached skills)", file=sys.stderr)
    sys.exit(4)

local_names = set()
# Skills the server listed but couldn't give us content for: still legitimate
# installs, so they must survive the stale-sweep below even though nothing
# was written for them this run.
protected = set()
created = updated = deleted = skipped_empty = 0
visible_slugs = []

for skill in skills:
    if not isinstance(skill, dict):
        continue
    slug = skill.get("slug")
    if not isinstance(slug, str) or not SLUG_RE.match(slug):
        continue  # skip malformed / hostile slug (never write it to disk)
    if slug in plugin_provided:
        continue

    local_name = f"skillnote-{slug}"
    skill_dir = os.path.join(skills_dir, local_name)
    if not contained(skill_dir):
        continue

    desc = skill.get("description")
    if not isinstance(desc, str):
        desc = ""
    colls = skill.get("collections") or []
    if not isinstance(colls, list):
        colls = []
    colls = [c for c in colls if isinstance(c, str)]
    if colls:
        desc = colls[0] + " · " + desc

    # Build frontmatter with JSON-encoded scalars (JSON is valid YAML), so a
    # newline / quote / colon in a name or description can't break the block.
    fm = [f"name: {json.dumps(local_name, ensure_ascii=False)}",
          f"description: {json.dumps(desc, ensure_ascii=False)}"]
    if colls:
        fm.append("collections: " + json.dumps(colls, ensure_ascii=False))
    fm.extend(safe_extra_frontmatter(skill.get("extra_frontmatter")))

    body = skill.get("content_md")
    if not isinstance(body, str):
        body = ""
    # The registry only embeds bodies when asked (?include=content). Against a
    # server that predates that parameter every body arrives empty — writing
    # those would silently replace good skills on disk with instruction-less
    # stubs, so skip the skill entirely and keep whatever is already there.
    if not body.strip():
        skipped_empty += 1
        protected.add(local_name)
        continue

    visible_slugs.append(slug)
    local_names.add(local_name)
    os.makedirs(skill_dir, exist_ok=True)
    host = api_url.split("://")[1].split(":")[0] if "://" in api_url else "localhost"
    web_url = f"http://{host}:3000"
    body = body.replace("{{API_URL}}", api_url).replace("{{WEB_URL}}", web_url)
    content = "---\n" + "\n".join(fm) + "\n---\n\n" + body

    filepath = os.path.join(skill_dir, "SKILL.md")
    if os.path.exists(filepath):
        try:
            with open(filepath, encoding="utf-8") as f:
                if f.read() == content:
                    continue
        except Exception:
            pass
        updated += 1
    else:
        created += 1
    atomic_write(filepath, content)

# A response where every skill lacked a body means the server can't give us
# content (too old for ?include=content, or a partial outage). We wrote
# nothing; deleting on top of that would strip a working install down to
# nothing on the strength of a degraded response. Leave the disk untouched.
if skipped_empty and not local_names:
    print(
        "SkillNote: server returned no skill content (keeping cached skills)",
        file=sys.stderr,
    )
    sys.exit(4)

# Delete skills no longer in the collection. Sources: manifest (validated) and
# an on-disk scan (catches orphans). Every candidate is re-validated + contained
# before removal so a tampered manifest can't delete outside skills_dir.
# Skills skipped for missing content are NOT in local_names, so they'd look
# stale — but they're still valid installs, so exclude them from deletion.
stale = set(old_managed) - local_names - protected
if os.path.isdir(skills_dir):
    for entry in os.listdir(skills_dir):
        if NAME_RE.match(entry) and entry not in local_names and entry not in protected:
            stale.add(entry)
for name in sorted(stale):
    if not NAME_RE.match(name):
        continue
    target = os.path.join(skills_dir, name)
    if not contained(target):
        continue
    try:
        if os.path.islink(target):
            os.unlink(target); deleted += 1
        elif os.path.isdir(target):
            shutil.rmtree(target); deleted += 1
    except OSError:
        pass

atomic_write(
    manifest_path,
    json.dumps({"skills": sorted(local_names | protected)}, indent=2),
)

# ── change summary (only when something changed; capped for large sets) ─────
parts = []
if created: parts.append(f"{created} new")
if updated: parts.append(f"{updated} updated")
if deleted: parts.append(f"{deleted} removed")
if not parts:
    sys.exit(0)  # nothing changed — stay silent

detail = ", ".join(parts)
col_name = collections_env or "all"
total = len(visible_slugs)
mode = os.environ.get("SKILLNOTE_MODE", "hook")

if mode == "hook":
    sys.exit(0)  # direct hook invocation — stdout would become model context

if mode == "prog":
    # Plain one-line summary for a calling script (auto-sync wraps it into hook
    # JSON). Built exclusively from validated slugs, digits, and fixed ASCII —
    # safe to embed. Keep it short.
    shown = ", ".join(visible_slugs[:6])
    if total > 6:
        shown += f" (+{total - 6} more)"
    print(f"SkillNote skills updated ({col_name}): {detail}. "
          f"{total} active: {shown}. "
          f"Each is in .codex/skills/skillnote-<name>/SKILL.md")
    sys.exit(0)

skills_path = os.path.abspath(skills_dir)
home = os.path.expanduser("~")
if skills_path.startswith(home):
    skills_path = "~" + skills_path[len(home):]

CAP = 12
# Clamp column width AND the slugs themselves — a 64-char (legal) slug would
# otherwise defeat the clamp via ljust and tear the right border.
col_w = 40
shown = [s if len(s) <= col_w - 6 else s[:col_w - 7] + "…" for s in visible_slugs[:CAP]]
col_w = min(max((len(s) for s in shown), default=0) + 6, col_w)
bw = max(col_w * 2 + 6, min(len(skills_path) + 10, 80), 50)
# A path longer than the box gets a keep-the-tail ellipsis; without this the
# arrow row overflows the right border on deeply nested projects.
max_path = bw - 8
if len(skills_path) > max_path:
    skills_path = "…" + skills_path[-(max_path - 1):]
dash = chr(9472)

C = "\x1b[1;36m"; G = "\x1b[32m"; D = "\x1b[2m"; B = "\x1b[1m"; R = "\x1b[0m"


def vlen(s):
    return len(re.sub(r"\x1b\[[0-9;]*m", "", s))


def row(content):
    pad = bw - 2 - vlen(content)
    print(f"    {D}{chr(9474)}{R}" + content + " " * max(0, pad) + f"{D}{chr(9474)}{R}")


def row_empty():
    print(f"    {D}{chr(9474)}{R}" + " " * (bw - 2) + f"{D}{chr(9474)}{R}")


def border_top(label):
    prefix = dash + " " + label + " "
    print(f"    {D}{chr(9581)}{prefix}{dash * max(0, bw - 2 - vlen(prefix))}{chr(9582)}{R}")


def border_bot(label):
    prefix = dash + dash + " " + label + " "
    print(f"    {D}{chr(9584)}{prefix}{dash * max(0, bw - 2 - vlen(prefix))}{chr(9583)}{R}")


print()
print(f" {C}✦ S K I L L N O T E{R}")
print()
border_top(f"{R}{B}{col_name}{R}{D} {dash}{dash} {G}{total} skills ({detail}){R}{D}")
row_empty()
for i in range(0, len(shown), 2):
    left = (f"{i+1:>2}. " + shown[i]).ljust(col_w)
    right = (f"{i+2:>2}. " + shown[i + 1]).ljust(col_w) if i + 1 < len(shown) else ""
    row(f"  {C}{left}{right}{R}")
if total > CAP:
    row(f"  {D}… and {total - CAP} more{R}")
row_empty()
row(f"  {D}{chr(8594)} {skills_path}{R}")
row_empty()
border_bot(f"{R}{C}/skills{R}{D} {chr(183)} {C}$skillnote:collection{R}{D}")
print()
PY
)
PYEXIT=$?

# 4 = deliberate "kept cached skills, nothing synced"; any other non-zero is a
# crash (suppress its partial output) — either way no sync happened, so prog
# callers must not stamp their throttle. tty/hook resolve to plain success.
[ "$PYEXIT" -ne 0 ] && bail_noop

if [ -n "$RESULT" ]; then
    echo "$RESULT"
fi
exit 0
