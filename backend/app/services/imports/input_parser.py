"""Port of Claude Code's parseMarketplaceInput.ts — see claude-code-source/src/utils/plugins/parseMarketplaceInput.ts.

Pure function. No I/O. Decides how a user's input string should be interpreted
for fetching a marketplace/plugin/skill from a remote or local location.
"""
from __future__ import annotations

import os
import re
from typing import Optional


ParsedSource = dict  # shape: {source_type, url?, repo?, ref?, path?}


_SSH_RE = re.compile(r"^([a-zA-Z0-9._-]+@[^:]+:.+?(?:\.git)?)(#(.+))?$")
_REF_RE = re.compile(r"^([^#@]+)(?:[#@](.+))?$")
_WINDOWS_PATH_RE = re.compile(r"^[a-zA-Z]:[/\\]")
# Repo shorthand: "owner/name" — exactly one slash, each side non-empty, no
# whitespace or shell metacharacters. Unicode characters are allowed here
# because later schema/name validation rejects them with a better error.
_REPO_RE = re.compile(r"^[^\s/@#:]+/[^\s/@#:]+$")
# Refs: alphanumerics, dot, dash, underscore, slash. No "..", no whitespace, no shell chars.
_REF_SHAPE_RE = re.compile(r"^[A-Za-z0-9._/-]+$")
# GitHub HTTPS URL: https://github.com/owner/repo (with optional www, trailing slash, or .git)
_GH_HTTPS_RE = re.compile(r"^https?://(?:www\.)?github\.com/([^/]+/[^/]+?)(?:/|\.git)?/?$")
# GitHub tree/blob URL: https://github.com/owner/repo/tree/<ref>[/subpath]
# Captures owner/repo (group 1), ref (group 2), optional subpath (group 3).
_GH_TREE_RE = re.compile(
    r"^https?://(?:www\.)?github\.com/([^/]+/[^/]+?)/(?:tree|blob)/([^/]+)(?:/(.*?))?/?$"
)


def parse_input(raw: str) -> Optional[dict]:
    """Parse a user input string. Return a ParsedSource dict on success, or
    None if the input is not recognized.

    This is a pure function: no filesystem I/O. Existence checks for local
    paths happen later in the pipeline (fetchers/validators)."""
    if raw is None:
        return None
    trimmed = raw.strip()
    if not trimmed:
        return None

    # Reject control characters anywhere in the input
    if "\n" in trimmed or "\r" in trimmed or "\0" in trimmed:
        return None

    # 1) SSH git URLs: user@host:path[.git][#ref]
    m = _SSH_RE.match(trimmed)
    if m:
        url = m.group(1)
        ref = m.group(3)
        if ref and not _is_safe_ref(ref):
            return None
        result: ParsedSource = {"source_type": "git", "url": url}
        if ref:
            result["ref"] = ref
        return result

    # 2) HTTP/HTTPS URLs
    if trimmed.startswith(("http://", "https://")):
        # Strip fragment for ref handling
        frag = trimmed.split("#", 1)
        url = frag[0]
        ref = frag[1] if len(frag) > 1 else None

        # Require a non-empty host component (reject "https://", "https:///")
        scheme_sep = url.find("://")
        host_and_path = url[scheme_sep + 3:] if scheme_sep != -1 else ""
        host = host_and_path.split("/", 1)[0]
        if not host:
            return None

        if ref and not _is_safe_ref(ref):
            return None

        # Explicit .git or /_git/ (Azure DevOps) → git clone
        if url.endswith(".git") or "/_git/" in url:
            r: ParsedSource = {"source_type": "git", "url": url}
            if ref:
                r["ref"] = ref
            return r

        # GitHub tree/blob URLs with explicit ref + subpath:
        #   https://github.com/owner/repo/tree/main/.agents/skills/brand-voice
        # Captures the subpath so the inspector can scope the clone's skill
        # walk — critical for large monorepos that would otherwise trip the
        # 50 MB clone cap.
        gh_tree = _GH_TREE_RE.match(url)
        if gh_tree:
            repo_slug = gh_tree.group(1).removesuffix(".git")
            tree_ref = gh_tree.group(2)
            tree_subpath = gh_tree.group(3) or None
            if not _is_safe_ref(tree_ref):
                return None
            if tree_subpath and (".." in tree_subpath.split("/") or tree_subpath.startswith("/")):
                return None
            r = {"source_type": "github", "repo": repo_slug, "ref": tree_ref}
            if tree_subpath:
                r["subpath"] = tree_subpath
            return r

        # GitHub URLs → classify as "github" source_type (same flow as shorthand)
        # so the inspector's API-probe + clone path handles them. Previously
        # classified as "git" which the inspector rejects with UNSUPPORTED_SOURCE_TYPE.
        gh = _GH_HTTPS_RE.match(url)
        if gh:
            repo_slug = gh.group(1).removesuffix(".git")
            if ref and not _is_safe_ref(ref):
                return None
            r = {"source_type": "github", "repo": repo_slug}
            if ref:
                r["ref"] = ref
            return r

        # Generic URL (e.g., raw marketplace.json)
        return {"source_type": "url", "url": url}

    # 3) Local paths (pure — no existence check; that happens in the fetcher)
    is_windows = os.name == "nt"
    is_win_path = is_windows and (
        trimmed.startswith(".\\") or trimmed.startswith("..\\")
        or bool(_WINDOWS_PATH_RE.match(trimmed))
    )
    # Bare "~" resolves to $HOME as a directory — intentional TS parity (homedir() + resolve()).
    if (
        trimmed.startswith("./")
        or trimmed.startswith("../")
        or trimmed.startswith("/")
        or trimmed.startswith("~")
        or is_win_path
    ):
        # Reject obviously-malformed paths: single-segment absolute paths like
        # "/repo" are almost always a user typo (they forgot the owner) and
        # not a real marketplace directory. Require at least one interior
        # separator on POSIX absolute paths.
        if trimmed.startswith("/") and "/" not in trimmed[1:]:
            return None
        expanded = os.path.expanduser(trimmed)
        # Preserve literal absolute paths (so /abs/path stays as /abs/path) while
        # normalizing relative/home paths to absolute. This matches the TS
        # reference's behavior of resolving with `path.resolve`, but keeps
        # tests independent of the machine's CWD for the absolute case.
        if os.path.isabs(expanded):
            resolved = expanded
        else:
            resolved = os.path.abspath(expanded)

        # .json files → file source; everything else → directory source.
        # The fetcher will later stat the path and surface ENOENT errors.
        if resolved.endswith(".json"):
            return {"source_type": "file", "path": resolved}
        return {"source_type": "directory", "path": resolved}

    # 4) GitHub shorthand: owner/repo, owner/repo@ref, owner/repo#ref
    if "/" in trimmed and not trimmed.startswith("@"):
        if ":" in trimmed:
            return None  # colon means SSH/custom, already handled
        m = _REF_RE.match(trimmed)
        if m:
            repo = m.group(1)
            ref = m.group(2)
            # Validate repo shape: one slash, only [A-Za-z0-9._-]
            if not _REPO_RE.match(repo):
                return None
            if ref and not _is_safe_ref(ref):
                return None
            r = {"source_type": "github", "repo": repo}
            if ref:
                r["ref"] = ref
            return r

    return None


def _is_safe_ref(ref: str) -> bool:
    """A git ref must be a reasonable-shaped token. Reject path-traversal, whitespace,
    shell metacharacters. Does NOT enforce git's full ref rules — leaves length
    and exotic-but-legal refs to the fetcher/validator."""
    if not ref:
        return False
    if ".." in ref:
        return False
    if not _REF_SHAPE_RE.match(ref):
        return False
    return True
