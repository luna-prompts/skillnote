"""Integration tests for the shallow clone + SKILL.md scanner in cloner.py."""
import os
import subprocess

import pytest


def _make_git_fixture(tmpdir, skills):
    """Create a local git repo with skills/<name>/SKILL.md files."""
    repo = os.path.join(tmpdir, "agents")
    os.makedirs(repo)
    subprocess.check_call(["git", "init", "-q"], cwd=repo)
    subprocess.check_call(["git", "config", "user.email", "t@t"], cwd=repo)
    subprocess.check_call(["git", "config", "user.name", "t"], cwd=repo)
    # Always create a README so the initial commit has something even when
    # `skills` is empty (used by oversize test that adds a big.bin later).
    with open(os.path.join(repo, "README.md"), "w") as f:
        f.write("# agents\n")
    for name, desc in skills:
        d = os.path.join(repo, "skills", name)
        os.makedirs(d)
        with open(os.path.join(d, "SKILL.md"), "w") as f:
            f.write(f"---\nname: {name}\ndescription: {desc}\n---\n\n# {name}\n")
    subprocess.check_call(["git", "add", "-A"], cwd=repo)
    subprocess.check_call(["git", "commit", "-qm", "seed"], cwd=repo)
    return repo


def _default_branch(repo: str) -> str:
    return subprocess.check_output(
        ["git", "-C", repo, "symbolic-ref", "--short", "HEAD"], text=True
    ).strip()


def test_clone_and_scan_skills(tmp_path):
    repo = _make_git_fixture(str(tmp_path), [
        ("python-expert", "Python code-review heuristics"),
        ("react-tuner", "React perf hints"),
    ])
    # Default branch may be 'master' or 'main' depending on git config
    default_branch = _default_branch(repo)
    parsed = {"source_type": "git", "url": f"file://{repo}", "ref": default_branch}
    from app.services.imports.cloner import clone_and_scan
    result = clone_and_scan(parsed, timeout_s=30)
    assert result.error_code is None, f"unexpected error: {result.error_code} / {result.error_message}"
    names = {s["name"] for s in result.skills}
    assert "python-expert" in names
    assert "react-tuner" in names
    assert all(s["content_hash"] for s in result.skills)


def test_clone_rejects_oversize(tmp_path):
    """50MB limit must abort the clone."""
    repo = _make_git_fixture(str(tmp_path), [])
    with open(os.path.join(repo, "big.bin"), "wb") as f:
        f.write(b"0" * (60 * 1024 * 1024))
    subprocess.check_call(["git", "-C", repo, "add", "big.bin"])
    subprocess.check_call(["git", "-C", repo, "commit", "-qm", "big"])
    default_branch = _default_branch(repo)
    parsed = {"source_type": "git", "url": f"file://{repo}", "ref": default_branch}
    from app.services.imports.cloner import clone_and_scan
    result = clone_and_scan(parsed, timeout_s=30)
    assert result.error_code == "REPO_TOO_LARGE"


def test_clone_invalid_repo(tmp_path):
    """Non-existent local path returns REPO_NOT_FOUND or similar error code."""
    parsed = {"source_type": "git", "url": f"file://{tmp_path}/does-not-exist", "ref": "main"}
    from app.services.imports.cloner import clone_and_scan
    result = clone_and_scan(parsed, timeout_s=10)
    assert result.error_code is not None
