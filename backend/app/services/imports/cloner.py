"""Shallow-clone + SKILL.md scanner. Streams git clone with size-capping."""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

import yaml

from app.services.imports.manifest_schema import SkillFrontmatter


MAX_CLONE_BYTES = 250 * 1024 * 1024  # 250 MB — generous for real monorepos;
# sparse-checkout is used when a subpath is specified so the clone stays small
MAX_SKILL_MD_BYTES = 256 * 1024


@dataclass
class CloneResult:
    skills: List[dict] = field(default_factory=list)
    resolved_sha: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None


def _safe_rel(root: Path, p: Path) -> Optional[str]:
    """Return `p` relative to `root`, or None if outside. Resolves symlinks."""
    try:
        rp = p.resolve().relative_to(root.resolve())
        return str(rp)
    except ValueError:
        return None


def clone_and_scan(parsed: dict, *, token: Optional[str] = None, timeout_s: int = 60) -> CloneResult:
    """Clone the repo shallowly, walk it for SKILL.md, enforce size/traversal rules."""
    url = parsed.get("url") or (
        f"https://github.com/{parsed['repo']}.git" if parsed.get("repo") else None
    )
    if not url:
        return CloneResult(error_code="INPUT_UNPARSEABLE", error_message="No URL or repo given")

    ref = parsed.get("ref")
    subpath = parsed.get("subpath") or ""

    tmp = tempfile.mkdtemp(prefix="skillnote-import-")
    try:
        clone_url = url
        if token and clone_url.startswith("https://github.com"):
            # Inject token for private repos via URL-embedded creds (one-shot; not persisted)
            clone_url = clone_url.replace("https://", f"https://{token}@", 1)

        # When a subpath is specified, use sparse-checkout to only fetch that
        # directory — avoids pulling in multi-GB monorepos and keeps large
        # repos well under the size cap.
        if subpath:
            cmd = ["git", "clone", "--depth=1", "--single-branch",
                   "--no-recurse-submodules", "--filter=blob:none",
                   "--sparse", "--no-checkout"]
            if ref:
                cmd += ["--branch", ref]
            cmd += [clone_url, tmp]
        else:
            cmd = ["git", "clone", "--depth=1", "--single-branch",
                   "--no-recurse-submodules"]
            if ref:
                cmd += ["--branch", ref]
            cmd += [clone_url, tmp]

        try:
            subprocess.run(cmd, check=True, timeout=timeout_s,
                           capture_output=True, text=True)
            if subpath:
                # Configure sparse-checkout for just the requested subpath
                subprocess.run(
                    ["git", "-C", tmp, "sparse-checkout", "set", "--no-cone", subpath],
                    check=True, timeout=timeout_s, capture_output=True, text=True,
                )
                subprocess.run(
                    ["git", "-C", tmp, "checkout"],
                    check=True, timeout=timeout_s, capture_output=True, text=True,
                )
        except subprocess.TimeoutExpired:
            return CloneResult(error_code="UPSTREAM_TIMEOUT",
                               error_message=f"Clone exceeded {timeout_s}s")
        except subprocess.CalledProcessError as e:
            msg = (e.stderr or "").strip()
            lowered = msg.lower()
            if "could not read username" in lowered or "authentication failed" in lowered:
                return CloneResult(error_code="REPO_PRIVATE", error_message="Auth required")
            if (
                "repository not found" in lowered
                or "does not exist" in lowered
                or "not a git repository" in lowered
                or "not found" in lowered
            ):
                return CloneResult(error_code="REPO_NOT_FOUND", error_message=msg[:200])
            return CloneResult(error_code="UPSTREAM_TIMEOUT", error_message=msg[:200])
        except FileNotFoundError:
            return CloneResult(error_code="UPSTREAM_TIMEOUT",
                               error_message="git binary not found")

        # Size cap
        total = 0
        for root, _, files in os.walk(tmp):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(root, f))
                except OSError:
                    continue
                if total > MAX_CLONE_BYTES:
                    return CloneResult(error_code="REPO_TOO_LARGE",
                                       error_message=f"Clone exceeds {MAX_CLONE_BYTES} bytes")

        # Resolve the clone SHA
        try:
            sha_out = subprocess.check_output(
                ["git", "-C", tmp, "rev-parse", "HEAD"], text=True).strip()
        except subprocess.CalledProcessError:
            sha_out = None

        # Walk and scan SKILL.md files
        root = Path(tmp) / subpath if subpath else Path(tmp)
        if not root.exists() or not root.is_dir():
            return CloneResult(error_code="SUBPATH_NOT_FOUND",
                               error_message=f"subpath '{subpath}' not in repo",
                               resolved_sha=sha_out)

        skills = []
        for p in root.rglob("SKILL.md"):
            rel = _safe_rel(Path(tmp), p)
            if rel is None:
                continue  # Symlink traversal outside tree — reject
            try:
                raw = p.read_bytes()
            except OSError:
                continue
            if len(raw) > MAX_SKILL_MD_BYTES:
                continue
            try:
                text = raw.decode("utf-8", errors="strict")
            except UnicodeDecodeError:
                continue
            if not text.startswith("---"):
                continue
            end = text.find("\n---", 3)
            if end < 0:
                continue
            fm_raw = text[3:end].strip()
            try:
                fm = yaml.safe_load(fm_raw) or {}
                if not isinstance(fm, dict):
                    continue
                validated = SkillFrontmatter.model_validate(fm)
            except Exception:
                continue  # skip invalid frontmatter
            skill_dir = p.parent.relative_to(Path(tmp))
            # Full markdown body after the closing `---`. Kept uncapped so the
            # importer can persist full content_md; the API endpoint truncates
            # to ~8 KB before returning to the browser.
            body = text[end + 4:].lstrip("\n")
            skills.append({
                "name": validated.name,
                "description": validated.description,
                "path": str(skill_dir),
                "content_hash": hashlib.sha256(raw).hexdigest(),
                "license": validated.license,
                "body": body,
            })

        return CloneResult(skills=skills, resolved_sha=sha_out)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
