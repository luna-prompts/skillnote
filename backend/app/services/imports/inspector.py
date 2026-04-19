"""Inspect a parsed source: resolve ref → SHA, detect kind, return preview.

I/O: makes HTTP requests to GitHub API (configurable via SKILLNOTE_IMPORT_GITHUB_API_BASE
env for tests). Future: shallow-clones for full skill listing (v1 scope: API-only metadata;
skill listing happens at apply-time).

Pure business logic. No DB writes.
"""
from __future__ import annotations

import json
import os
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import List, Optional


GITHUB_API_BASE = lambda: os.environ.get("SKILLNOTE_IMPORT_GITHUB_API_BASE", "https://api.github.com")


@dataclass
class InspectResult:
    source_type: Optional[str] = None
    url: Optional[str] = None
    host: Optional[str] = None
    owner: Optional[str] = None
    repo: Optional[str] = None
    ref: Optional[str] = None
    resolved_sha: Optional[str] = None
    subpath: Optional[str] = None
    kind: Optional[str] = None  # marketplace|plugin|skill_bundle|single_skill
    skills: List[dict] = field(default_factory=list)
    manifest: Optional[dict] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None


def inspect_source(parsed: Optional[dict], *, token: Optional[str] = None, timeout_s: int = 30) -> InspectResult:
    """Given a ParsedSource from input_parser, resolve metadata from upstream.

    For v1 we only implement the GitHub API probe — enough for kind=github flows.
    Other source types return a stub InspectResult with appropriate error_code.
    """
    if parsed is None:
        return InspectResult(error_code="INPUT_UNPARSEABLE", error_message="input could not be parsed")
    if "error" in parsed:
        return InspectResult(error_code="INPUT_UNPARSEABLE", error_message=parsed["error"])

    source_type = parsed["source_type"]
    if source_type != "github":
        # v1 covers github only; other types fall to apply-time clone
        return InspectResult(source_type=source_type, error_code="UNSUPPORTED_SOURCE_TYPE",
                             error_message=f"source_type={source_type} not yet inspected")

    repo = parsed["repo"]
    owner_str, repo_str = repo.split("/", 1)
    # If no ref given, fetch the default branch from /repos/{o}/{r} first.
    # Hardcoding "main" breaks for repos still on "master" (Bug #1).
    ref = parsed.get("ref")
    api_base = GITHUB_API_BASE().rstrip("/")
    if not ref:
        try:
            probe_req = urllib.request.Request(
                f"{api_base}/repos/{owner_str}/{repo_str}",
                headers={"User-Agent": "skillnote-import/0.3.3",
                         **({"Authorization": f"token {token}"} if token else {})},
            )
            with urllib.request.urlopen(probe_req, timeout=timeout_s) as resp:
                meta = json.loads(resp.read())
            ref = meta.get("default_branch") or "main"
        except Exception:
            # Fall back — git clone (no --branch) will pick HEAD
            ref = None
    api_url = f"{api_base}/repos/{owner_str}/{repo_str}/commits/{ref or 'HEAD'}"
    headers = {"User-Agent": "skillnote-import/0.3.3"}
    if token:
        headers["Authorization"] = f"token {token}"

    try:
        req = urllib.request.Request(api_url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            body = json.loads(resp.read())
            sha = body.get("sha")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return InspectResult(error_code="REPO_NOT_FOUND",
                                 error_message=f"{repo}@{ref} not found")
        if e.code == 401 or e.code == 403:
            return InspectResult(error_code="REPO_PRIVATE",
                                 error_message="Add a GitHub token to continue")
        if e.code == 429:
            return InspectResult(error_code="RATE_LIMITED",
                                 error_message="GitHub rate limit exceeded")
        return InspectResult(error_code="UPSTREAM_TIMEOUT",
                             error_message=f"HTTP {e.code}")
    except (TimeoutError, socket.timeout):
        return InspectResult(error_code="UPSTREAM_TIMEOUT",
                             error_message=f"Took longer than {timeout_s}s")
    except urllib.error.URLError as e:
        # URLError may wrap a timeout — detect and normalize to UPSTREAM_TIMEOUT
        reason = getattr(e, "reason", None)
        if isinstance(reason, (TimeoutError, socket.timeout)):
            return InspectResult(error_code="UPSTREAM_TIMEOUT",
                                 error_message=f"Took longer than {timeout_s}s")
        return InspectResult(error_code="UPSTREAM_TIMEOUT",
                             error_message="Upstream unreachable")

    from app.services.imports.cloner import clone_and_scan

    # Attempt clone + SKILL.md scan for github source type
    clone_parsed = {
        "source_type": "github",
        "url": f"https://github.com/{repo}.git",
        "ref": ref,
        "subpath": parsed.get("subpath"),
    }
    clone_result = clone_and_scan(clone_parsed, token=token, timeout_s=timeout_s)

    if clone_result.error_code:
        return InspectResult(
            source_type="github",
            error_code=clone_result.error_code,
            error_message=clone_result.error_message,
        )

    return InspectResult(
        source_type="github",
        url=f"github.com/{repo}",
        host="github.com",
        owner=owner_str,
        repo=repo_str,
        ref=ref,
        resolved_sha=clone_result.resolved_sha or sha,
        subpath=parsed.get("subpath"),
        kind="plugin",  # full kind detection (marketplace vs plugin vs skill_bundle) = future
        skills=clone_result.skills,
    )
